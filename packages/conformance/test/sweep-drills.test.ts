import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCounter, runGraphSubscriptionRemoved, verifyGoogle410 } from "../src/drills.ts";
import type { SoakHost } from "../src/load.ts";
import type { GraphSubscription } from "../src/providers/graph.ts";
import { graphDrillDue, parseHosts, providerKind, soakDayIndex } from "../src/run.ts";
import type { BookingLine, BusyLine, DrillLine, LagLine } from "../src/store.ts";
import { SoakStore } from "../src/store.ts";
import { computeSweep } from "../src/sweep.ts";
import { TimewayHostSession } from "../src/timeway.ts";

const line = (o: Partial<BookingLine>): BookingLine => ({
  attemptId: "a",
  host: "soak-g1",
  provider: "google_calendar",
  eventTypeId: 1,
  start: "2026-11-03T09:00:00.000Z",
  end: "2026-11-03T09:30:00.000Z",
  attemptedAt: "2026-11-02T10:00:00.000Z",
  reservedAt: "2026-11-02T10:00:01.000Z",
  postSentAt: "2026-11-02T10:01:00.000Z",
  respondedAt: "2026-11-02T10:01:01.000Z",
  formGapMs: 59_000,
  injection: { phase: "none", busyId: null, providerEventId: null, createdAt: null },
  classification: "accepted",
  status: 200,
  reason: null,
  bookingUid: "u1",
  providerEventId: "e1",
  ...o,
});

describe("computeSweep (S5 counts)", () => {
  const base = {
    day: "2026-11-02",
    sweptAt: "2026-11-03T00:10:00.000Z",
    hosts: ["soak-g1"],
    lagLines: [] as LagLine[],
  };

  it("clean day: matched booking and provider event, no double-bookings or orphans", () => {
    const s = computeSweep({
      ...base,
      bookingLines: [line({})],
      busyLines: [],
      timewayBookings: {
        "soak-g1": [
          { uid: "u1", start: line({}).start, end: line({}).end, status: "accepted", createdAt: null },
        ],
      },
      providerEvents: {
        "soak-g1": [{ id: "e1", host: "soak-g1", start: line({}).start, end: line({}).end }],
      },
    });
    expect(s.bookingSource).toBe("timeway-list");
    expect(s.totals).toMatchObject({ attempts: 1, accepted: 1, doubleBookings: 0, orphans: 0 });
  });

  it("counts a booking over a soak-busy that existed at POST time, and orphans both ways", () => {
    const busy: BusyLine[] = [
      {
        op: "create",
        busyId: "x",
        host: "soak-g1",
        providerEventId: "bx",
        start: "2026-11-03T09:00:00.000Z",
        end: "2026-11-03T09:30:00.000Z",
        at: "2026-11-02T10:00:30.000Z",
        purpose: "in-form",
      },
    ];
    const s = computeSweep({
      ...base,
      bookingLines: [line({})],
      busyLines: busy,
      timewayBookings: undefined,
      providerEvents: {
        "soak-g1": [
          {
            id: "stray",
            host: "soak-g1",
            start: "2026-11-04T09:00:00.000Z",
            end: "2026-11-04T09:30:00.000Z",
          },
        ],
      },
    });
    expect(s.bookingSource).toBe("runner-log");
    expect(s.totals.doubleBookings).toBe(1);
    expect(s.orphans).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "booking-without-provider-event", bookingUid: "u1" }),
        expect.objectContaining({ type: "provider-event-without-booking", providerEventId: "stray" }),
      ])
    );
  });

  it("a busy injected after the POST is a race the booking won, not a double-booking", () => {
    const s = computeSweep({
      ...base,
      bookingLines: [line({})],
      busyLines: [
        {
          op: "create",
          busyId: "late",
          host: "soak-g1",
          providerEventId: "bl",
          start: "2026-11-03T09:00:00.000Z",
          end: "2026-11-03T09:30:00.000Z",
          at: "2026-11-02T10:02:00.000Z",
          purpose: "in-form",
        },
      ],
      providerEvents: {
        "soak-g1": [{ id: "e1", host: "soak-g1", start: line({}).start, end: line({}).end }],
      },
    });
    expect(s.totals.doubleBookings).toBe(0);
  });
});

describe("TimewayHostSession", () => {
  it("signs in with the NextAuth credentials flow and pages bookings.get", async () => {
    const calls: string[] = [];
    const fetch = async (url: string, init: RequestInit = {}) => {
      calls.push(`${init.method ?? "GET"} ${new URL(url).pathname}`);
      if (url.endsWith("/api/auth/csrf"))
        return new Response(JSON.stringify({ csrfToken: "c" }), {
          headers: { "set-cookie": "__Secure-next-auth.csrf-token=abc; Path=/; HttpOnly" },
        });
      if (url.includes("/api/auth/callback/credentials"))
        return new Response(null, {
          status: 302,
          headers: { "set-cookie": "__Secure-next-auth.session-token=sess; Path=/; HttpOnly" },
        });
      const input = JSON.parse(decodeURIComponent(new URL(url).searchParams.get("input") ?? "")).json;
      expect(String(init.headers && (init.headers as Record<string, string>).cookie)).toContain(
        "session-token=sess"
      );
      const bookings =
        input.filters.status === "upcoming"
          ? [
              {
                uid: "u1",
                startTime: "2026-11-03T09:00:00Z",
                endTime: "2026-11-03T09:30:00Z",
                status: "ACCEPTED",
              },
            ]
          : [];
      return new Response(JSON.stringify({ result: { data: { json: { bookings, hasMore: false } } } }));
    };
    const s = new TimewayHostSession({ email: "e", password: "p" }, { fetch, baseUrl: "https://tw.test" });
    const list = await s.listBookings("2026-11-01T00:00:00Z", "2026-11-10T00:00:00Z");
    expect(list).toEqual([
      {
        uid: "u1",
        start: "2026-11-03T09:00:00.000Z",
        end: "2026-11-03T09:30:00.000Z",
        status: "accepted",
        createdAt: null,
      },
    ]);
    expect(calls.slice(0, 2)).toEqual(["GET /api/auth/csrf", "POST /api/auth/callback/credentials"]);
  });
});

const fakeClock = () => {
  let t = Date.parse("2026-11-06T12:00:00Z");
  return { now: () => t, sleep: async (ms: number) => void (t += ms) };
};
const host = { username: "soak-o1", calendarId: "cal-o1" } as SoakHost;
const sample = (t1: string | null): LagLine => ({
  busyId: "b",
  host: "soak-o1",
  kind: "insert",
  slotStart: "x",
  t0: "2026-11-06T12:00:00.000Z",
  t1,
  polls: 1,
});

describe("drills (S6)", () => {
  it("Graph subscriptionRemoved: delete, lifecycle POST, new subscription -> PASS in drills.jsonl", async () => {
    const store = new SoakStore(mkdtempSync(join(tmpdir(), "soak-drill-")));
    const sub = (id: string): GraphSubscription => ({
      id,
      resource: "me/calendars/cal-o1/events",
      changeType: "created,updated,deleted",
      notificationUrl: "https://tw/x",
      expirationDateTime: "2026-11-09T00:00:00Z",
    });
    let subs = [sub("old")];
    let listCalls = 0;
    const graph = {
      listSubscriptions: async () => {
        listCalls++;
        if (listCalls === 3) subs = [sub("new")];
        return subs;
      },
      deleteSubscription: async (id: string) => {
        subs = subs.filter((s) => s.id !== id);
      },
    };
    const notified: string[] = [];
    const d = await runGraphSubscriptionRemoved({
      store,
      host,
      graph,
      timewayBaseUrl: "https://tw.test",
      clientState: "cs",
      probe: async () => [sample("2026-11-06T12:00:20.000Z")],
      clock: fakeClock(),
      notify: async (i) => {
        notified.push(`${i.subscriptionId}:${i.lifecycleEvent}`);
        return { status: 202 };
      },
    });
    expect(notified).toEqual(["old:subscriptionRemoved"]);
    expect(d.pass).toBe(true);
    expect(d.details.newSubscriptionId).toBe("new");
    expect(store.read<DrillLine>("drills")).toHaveLength(1);
  });

  it("Graph drill fails when no new subscription appears within 15 min", async () => {
    const store = new SoakStore(mkdtempSync(join(tmpdir(), "soak-drill-")));
    let subs: GraphSubscription[] = [
      {
        id: "old",
        resource: "me/calendars/cal-o1/events",
        changeType: "c",
        notificationUrl: "u",
        expirationDateTime: "e",
      },
    ];
    const d = await runGraphSubscriptionRemoved({
      store,
      host,
      graph: {
        listSubscriptions: async () => subs,
        deleteSubscription: async () => {
          subs = [];
        },
      },
      timewayBaseUrl: "https://tw.test",
      clientState: "cs",
      probe: async () => [],
      clock: fakeClock(),
      notify: async () => ({ status: 202 }),
    });
    expect(d.pass).toBe(false);
  });

  it("410 verify: PASS once the invalidation counter moves and lag samples flip again", async () => {
    const store = new SoakStore(mkdtempSync(join(tmpdir(), "soak-drill-")));
    const counter = [3, 3, 4];
    const d = await verifyGoogle410({
      store,
      host: { ...host, username: "soak-g1" },
      probe: async () => [sample("2026-11-06T12:00:20.000Z"), sample("2026-11-06T12:00:40.000Z")],
      clock: fakeClock(),
      readCounter: async () => counter.shift() ?? 4,
    });
    expect(d.pass).toBe(true);
    expect(d.details).toMatchObject({ counterBefore: 3, counterAfter: 4, lagResumed: true });
  });

  it("410 verify: FAIL when lag samples keep timing out", async () => {
    const store = new SoakStore(mkdtempSync(join(tmpdir(), "soak-drill-")));
    const d = await verifyGoogle410({
      store,
      host,
      probe: async () => [sample(null), sample(null)],
      clock: fakeClock(),
    });
    expect(d.pass).toBe(false);
  });

  it("parses the 410 counter from the WC-TW-3 metrics body", () => {
    const body = [
      "# TYPE timeway_sync_token_invalidated_total counter",
      'timeway_sync_token_invalidated_total{provider="google_calendar"} 7',
      'timeway_sync_token_invalidated_total{provider="office365_calendar"} 2',
    ].join("\n");
    expect(parseCounter(body, "timeway_sync_token_invalidated_total", { provider: "google_calendar" })).toBe(
      7
    );
    expect(parseCounter("", "timeway_sync_token_invalidated_total", {})).toBeNull();
  });
});

describe("run.ts config", () => {
  it("parses SOAK_HOSTS and maps soak-o* to Graph", () => {
    const hosts = parseHosts(
      JSON.stringify([
        { username: "soak-g1", eventTypeId: 1, calendarId: "g1" },
        { username: "soak-o1", eventTypeId: 2, calendarId: "o1" },
      ])
    );
    expect(hosts.map(providerKind)).toEqual(["google_calendar", "office365_calendar"]);
    expect(() => parseHosts("[]")).toThrow();
    expect(() => parseHosts(JSON.stringify([{ username: "x" }]))).toThrow();
  });

  it("schedules the Graph drill from soak day 5 until one passes", () => {
    const start = "2026-11-01";
    expect(soakDayIndex(start, Date.parse("2026-11-05T23:00:00Z"))).toBe(4);
    expect(soakDayIndex(start, Date.parse("2026-10-31T23:00:00Z"))).toBeNull();
    const store = new SoakStore(mkdtempSync(join(tmpdir(), "soak-run-")));
    const rt = (now: string) =>
      ({ env: { SOAK_START_DAY: start }, clock: { now: () => Date.parse(now) }, store }) as never;
    expect(graphDrillDue(rt("2026-11-05T12:00:00Z"))).toBe(false);
    expect(graphDrillDue(rt("2026-11-06T00:01:00Z"))).toBe(true);
    store.append("drills", {
      kind: "graphSubscriptionRemoved",
      at: "2026-11-06T00:05:00Z",
      finishedAt: "x",
      host: "soak-o1",
      pass: true,
      details: {},
    });
    expect(graphDrillDue(rt("2026-11-06T01:00:00Z"))).toBe(false);
  });
});
