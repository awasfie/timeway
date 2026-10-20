import { describe, expect, it, vi } from "vitest";
import type { FetchLike } from "../src/http.ts";
import { backoffDelayMs, fetchWithRetry, SoakHttpError } from "../src/http.ts";
import { GoogleCalendarClient } from "../src/providers/google.ts";
import { fromGraphUtc, GraphCalendarClient, sendLifecycleNotification } from "../src/providers/graph.ts";
import { classifyBookResponse, isSlotOffered, TimewayClient } from "../src/timeway.ts";

type Call = { url: string; init: RequestInit };

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

/** Scripted fetch: each call shifts the next responder; never touches the network. */
function scripted(responders: Array<(call: Call) => Response | Promise<Response>>) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init = {}) => {
    const call = { url, init };
    calls.push(call);
    const next = responders.shift();
    if (!next) throw new Error(`unexpected fetch ${url}`);
    return next(call);
  };
  return { fetch, calls };
}

const noSleep = vi.fn(async () => {});
const bodyOf = (c: Call) => JSON.parse(String(c.init.body));

describe("fetchWithRetry", () => {
  it("retries 429/5xx and returns the first non-retryable response", async () => {
    const { fetch, calls } = scripted([
      () => json(429, {}),
      () => json(503, {}),
      () => json(200, { ok: true }),
    ]);
    const sleep = vi.fn(async () => {});
    const res = await fetchWithRetry("https://x.test/a", {}, "t", { fetch, sleep, random: () => 0.5 });
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("gives up after 5 tries with a typed error", async () => {
    const { fetch, calls } = scripted(Array.from({ length: 5 }, () => () => json(500, { e: 1 })));
    const err = await fetchWithRetry("https://x.test/a", {}, "ctx", {
      fetch,
      sleep: noSleep,
      maxTries: 9,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(SoakHttpError);
    expect(err).toMatchObject({ kind: "server", status: 500, attempts: 5 });
    expect(calls).toHaveLength(5);
  });

  it("does not retry a 4xx such as 410", async () => {
    const { fetch, calls } = scripted([() => json(410, {})]);
    const res = await fetchWithRetry("https://x.test/a", {}, "t", { fetch, sleep: noSleep });
    expect(res.status).toBe(410);
    expect(calls).toHaveLength(1);
  });

  it("network failures surface as kind=network", async () => {
    const fetch: FetchLike = async () => {
      throw new Error("ECONNRESET");
    };
    await expect(fetchWithRetry("https://x.test", {}, "t", { fetch, sleep: noSleep })).rejects.toMatchObject({
      kind: "network",
    });
  });

  it("jittered backoff stays within the exponential ceiling and honours Retry-After", () => {
    expect(backoffDelayMs(0, null, () => 0.999)).toBeLessThan(500);
    expect(backoffDelayMs(3, null, () => 0.999)).toBeLessThan(4000);
    expect(backoffDelayMs(20, null, () => 0.999)).toBeLessThanOrEqual(30_000);
    expect(backoffDelayMs(0, "7", () => 0)).toBe(7000);
  });
});

describe("GoogleCalendarClient", () => {
  const oauth = { clientId: "cid", clientSecret: "sec", refreshToken: "rt" };

  it("refreshes once, inserts an opaque soak-busy event with sendUpdates=none, and reuses the token", async () => {
    const { fetch, calls } = scripted([
      () => json(200, { access_token: "at1", expires_in: 3600 }),
      () =>
        json(200, {
          id: "ev1",
          summary: "soak-busy-42",
          transparency: "opaque",
          start: { dateTime: "2026-11-02T10:00:00Z" },
          end: { dateTime: "2026-11-02T10:30:00Z" },
        }),
      () => json(204, null),
    ]);
    const g = new GoogleCalendarClient(oauth, { fetch, sleep: noSleep, now: () => 0 });
    const ev = await g.insertBusyEvent("cal@group", {
      soakId: "42",
      start: "2026-11-02T10:00:00Z",
      end: "2026-11-02T10:30:00Z",
    });
    await g.deleteEvent("cal@group", "ev1");

    expect(ev).toEqual({
      id: "ev1",
      title: "soak-busy-42",
      start: "2026-11-02T10:00:00Z",
      end: "2026-11-02T10:30:00Z",
      busy: true,
    });
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(String(calls[0].init.body)).toContain("grant_type=refresh_token");
    expect(calls[1].url).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/cal%40group/events?sendUpdates=none"
    );
    expect(bodyOf(calls[1])).toMatchObject({ summary: "soak-busy-42", transparency: "opaque" });
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe("Bearer at1");
    expect(calls[2].init.method).toBe("DELETE");
    expect(calls).toHaveLength(3);
  });

  it("lists a window across pages and drops cancelled events", async () => {
    const { fetch, calls } = scripted([
      () => json(200, { access_token: "at", expires_in: 3600 }),
      () =>
        json(200, {
          items: [{ id: "a", summary: "x", start: { dateTime: "s" }, end: { dateTime: "e" } }],
          nextPageToken: "p2",
        }),
      () =>
        json(200, {
          items: [
            { id: "b", status: "cancelled" },
            { id: "c", transparency: "transparent", start: { date: "d" }, end: { date: "d2" } },
          ],
        }),
    ]);
    const g = new GoogleCalendarClient(oauth, { fetch, sleep: noSleep });
    const events = await g.listEvents("c1", { start: "2026-11-02T00:00:00Z", end: "2026-11-03T00:00:00Z" });
    expect(events.map((e) => [e.id, e.busy])).toEqual([
      ["a", true],
      ["c", false],
    ]);
    expect(calls[2].url).toContain("pageToken=p2");
    expect(calls[1].url).toContain("singleEvents=true");
  });

  it("a failed token refresh is a typed auth error", async () => {
    const { fetch } = scripted([() => json(401, { error: "invalid_grant" })]);
    const g = new GoogleCalendarClient(oauth, { fetch, sleep: noSleep });
    await expect(g.listEvents("c", { start: "a", end: "b" })).rejects.toMatchObject({
      kind: "auth",
      status: 401,
    });
  });
});

describe("GraphCalendarClient", () => {
  const oauth = { clientId: "cid", clientSecret: "sec", refreshToken: "rt" };

  it("uses the consumers authority, reports a rotated refresh token, and inserts a busy event in UTC", async () => {
    const rotated = vi.fn();
    const { fetch, calls } = scripted([
      () => json(200, { access_token: "at", expires_in: 3600, refresh_token: "rt2" }),
      () =>
        json(201, {
          id: "m1",
          subject: "soak-busy-7",
          showAs: "busy",
          start: { dateTime: "2026-11-02T10:00:00.0000000", timeZone: "UTC" },
          end: { dateTime: "2026-11-02T10:30:00.0000000", timeZone: "UTC" },
        }),
    ]);
    const m = new GraphCalendarClient(oauth, { fetch, sleep: noSleep, onRefreshTokenRotated: rotated });
    const ev = await m.insertBusyEvent("CAL=", {
      soakId: "7",
      start: "2026-11-02T10:00:00Z",
      end: "2026-11-02T10:30:00Z",
    });
    expect(calls[0].url).toBe("https://login.microsoftonline.com/consumers/oauth2/v2.0/token");
    expect(rotated).toHaveBeenCalledWith("rt2");
    expect(calls[1].url).toBe("https://graph.microsoft.com/v1.0/me/calendars/CAL%3D/events");
    expect(bodyOf(calls[1])).toMatchObject({
      subject: "soak-busy-7",
      showAs: "busy",
      start: { dateTime: "2026-11-02T10:00:00.000", timeZone: "UTC" },
    });
    expect(ev).toMatchObject({
      id: "m1",
      start: "2026-11-02T10:00:00.000Z",
      end: "2026-11-02T10:30:00.000Z",
      busy: true,
    });
  });

  it("follows @odata.nextLink for calendarView and subscriptions, and deletes a subscription", async () => {
    const { fetch, calls } = scripted([
      () => json(200, { access_token: "at", expires_in: 3600 }),
      () =>
        json(200, {
          value: [{ id: "a", showAs: "busy" }],
          "@odata.nextLink": "https://graph.microsoft.com/v1.0/next1",
        }),
      () =>
        json(200, {
          value: [
            { id: "b", showAs: "free" },
            { id: "c", isCancelled: true },
          ],
        }),
      () => json(200, { value: [{ id: "s1", resource: "me/events" }] }),
      () => json(204, null),
    ]);
    const m = new GraphCalendarClient(oauth, { fetch, sleep: noSleep });
    const events = await m.listEvents("c", { start: "2026-11-02T00:00:00Z", end: "2026-11-03T00:00:00Z" });
    expect(events.map((e) => [e.id, e.busy])).toEqual([
      ["a", true],
      ["b", false],
    ]);
    expect(calls[1].url).toContain("/me/calendars/c/calendarView?");
    expect(calls[2].url).toBe("https://graph.microsoft.com/v1.0/next1");
    const subs = await m.listSubscriptions();
    expect(subs.map((s) => s.id)).toEqual(["s1"]);
    await m.deleteSubscription("s1");
    expect(calls[4]).toMatchObject({
      url: "https://graph.microsoft.com/v1.0/subscriptions/s1",
      init: { method: "DELETE" },
    });
  });

  it("posts a subscriptionRemoved lifecycle notification to the Timeway lifecycle route", async () => {
    const { fetch, calls } = scripted([() => json(202, { message: "Accepted" })]);
    const res = await sendLifecycleNotification(
      { timewayBaseUrl: "https://tw.test", subscriptionId: "s1", clientState: "client-state-from-env" },
      { fetch, sleep: noSleep }
    );
    expect(res.status).toBe(202);
    expect(calls[0].url).toBe(
      "https://tw.test/api/webhooks/calendar-subscription/office365_calendar?lifecycle=1"
    );
    expect(bodyOf(calls[0]).value[0]).toMatchObject({
      subscriptionId: "s1",
      lifecycleEvent: "subscriptionRemoved",
      clientState: "client-state-from-env",
    });
  });

  it("parses Graph's 7-digit fraction as UTC", () => {
    expect(fromGraphUtc({ dateTime: "2026-11-02T10:00:00.1234567", timeZone: "UTC" })).toBe(
      "2026-11-02T10:00:00.123Z"
    );
  });
});

describe("TimewayClient", () => {
  const base = "https://tw.test";

  it("getSlots reads the booker's tRPC getSchedule and flattens slot times", async () => {
    const { fetch, calls } = scripted([
      () =>
        json(200, {
          result: {
            data: {
              json: {
                slots: {
                  "2026-11-02": [{ time: "2026-11-02T10:00:00.000Z" }, { time: "2026-11-02T10:30:00Z" }],
                },
              },
            },
          },
        }),
    ]);
    const tw = new TimewayClient({ baseUrl: base, fetch, sleep: noSleep });
    const slots = await tw.getSlots("soak-g1", "soak-30", {
      start: "2026-11-02T00:00:00Z",
      end: "2026-11-03T00:00:00Z",
    });
    expect(slots).toEqual({ "2026-11-02": ["2026-11-02T10:00:00.000Z", "2026-11-02T10:30:00.000Z"] });
    const url = new URL(calls[0].url);
    expect(url.pathname).toBe("/api/trpc/slots/getSchedule");
    expect(JSON.parse(url.searchParams.get("input") ?? "")).toEqual({
      json: {
        usernameList: ["soak-g1"],
        eventTypeSlug: "soak-30",
        startTime: "2026-11-02T00:00:00Z",
        endTime: "2026-11-03T00:00:00Z",
        timeZone: "UTC",
        isTeamEvent: false,
      },
    });
    expect(isSlotOffered(slots, "2026-11-02T10:30:00.000Z")).toBe(true);
    expect(isSlotOffered(slots, "2026-11-02T11:00:00.000Z")).toBe(false);
  });

  it("reserveSlot posts the hold and returns its uid", async () => {
    const { fetch, calls } = scripted([() => json(200, { result: { data: { json: { uid: "hold-1" } } } })]);
    const tw = new TimewayClient({ baseUrl: base, fetch, sleep: noSleep });
    await expect(tw.reserveSlot({ eventTypeId: 9, start: "s", end: "e" })).resolves.toEqual({
      uid: "hold-1",
    });
    expect(calls[0].url).toBe(`${base}/api/trpc/slots/reserveSlot`);
    expect(bodyOf(calls[0])).toEqual({
      json: { eventTypeId: 9, slotUtcStartDate: "s", slotUtcEndDate: "e" },
    });
  });

  it("book sends the web booker body with reservedSlotUid and classifies acceptance", async () => {
    const { fetch, calls } = scripted([() => json(200, { id: 5, uid: "bk-1", status: "ACCEPTED" })]);
    const tw = new TimewayClient({ baseUrl: base, fetch, sleep: noSleep });
    const r = await tw.book({
      eventTypeId: 9,
      start: "2026-11-02T10:00:00.000Z",
      end: "2026-11-02T10:30:00.000Z",
      name: "Soak",
      email: "soak+run1@awstreams.com",
      reservedSlotUid: "hold-1",
      metadata: { soakAttempt: "a1" },
    });
    expect(r).toEqual({
      classification: "accepted",
      status: 200,
      reason: null,
      bookingUid: "bk-1",
      bookingId: 5,
      bookingStatus: "ACCEPTED",
    });
    expect(calls[0].url).toBe(`${base}/api/book/event`);
    expect(bodyOf(calls[0])).toMatchObject({
      start: "2026-11-02T10:00:00.000Z",
      end: "2026-11-02T10:30:00.000Z",
      eventTypeId: 9,
      responses: { name: "Soak", email: "soak+run1@awstreams.com" },
      timeZone: "UTC",
      language: "en",
      metadata: { soakAttempt: "a1" },
      reservedSlotUid: "hold-1",
    });
  });

  it("book never retries: one 503 is rejected-other", async () => {
    const { fetch, calls } = scripted([() => json(503, { message: "busy" })]);
    const tw = new TimewayClient({ baseUrl: base, fetch, sleep: noSleep });
    const r = await tw.book({ eventTypeId: 1, start: "s", end: "e", name: "n", email: "e@x.test" });
    expect(r.classification).toBe("rejected-other");
    expect(calls).toHaveLength(1);
  });

  it("classifies 409 conflict codes as rejected-conflict and anything else as rejected-other", () => {
    expect(classifyBookResponse(409, { message: "booking_conflict_error" }).classification).toBe(
      "rejected-conflict"
    );
    expect(classifyBookResponse(409, { message: "no_available_users_found_error" }).classification).toBe(
      "rejected-conflict"
    );
    expect(classifyBookResponse(409, { message: "payment_not_created_error" }).classification).toBe(
      "rejected-other"
    );
    expect(classifyBookResponse(502, { message: "booking_calendar_write_failed_error" }).classification).toBe(
      "rejected-other"
    );
    expect(classifyBookResponse(429, { message: "Rate limit exceeded" }).classification).toBe(
      "rejected-other"
    );
  });

  it("cancel fetches a CSRF token and posts it as body + cookie", async () => {
    const token = "a".repeat(64);
    const { fetch, calls } = scripted([
      () => json(200, { csrfToken: token }),
      () => json(200, { success: true }),
    ]);
    const tw = new TimewayClient({ baseUrl: base, fetch, sleep: noSleep });
    await expect(tw.cancel("bk-1")).resolves.toEqual({ success: true, status: 200 });
    expect(calls[0].url).toBe(`${base}/api/csrf`);
    expect(calls[1].url).toBe(`${base}/api/cancel`);
    expect(bodyOf(calls[1])).toMatchObject({ uid: "bk-1", csrfToken: token });
    expect((calls[1].init.headers as Record<string, string>).cookie).toBe(`calcom.csrf_token=${token}`);
  });

  it("defaults to prod but no test here reaches it", () => {
    expect(new TimewayClient({ fetch: async () => json(200, {}) }).baseUrl).toBe("https://timeway.co");
  });
});
