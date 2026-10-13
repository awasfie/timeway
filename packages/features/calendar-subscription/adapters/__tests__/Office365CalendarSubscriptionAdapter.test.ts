import process from "node:process";
import type { SelectedCalendar } from "@calcom/prisma/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Office365CalendarSubscriptionAdapter } from "../Office365CalendarSubscription.adapter";

const _mockSelectedCalendar: SelectedCalendar = {
  id: "test-calendar-id",
  userId: 1,
  credentialId: 1,
  integration: "office365_calendar",
  externalId: "test@example.com",
  eventTypeId: null,
  delegationCredentialId: null,
  googleChannelId: null,
  googleChannelKind: null,
  googleChannelResourceId: null,
  googleChannelResourceUri: null,
  googleChannelExpiration: null,
  error: null,
  lastErrorAt: null,
  watchAttempts: 0,
  maxAttempts: 3,
  unwatchAttempts: 0,
  createdAt: new Date(),
  updatedAt: new Date(),
  channelId: "test-channel-id",
  channelKind: "web_hook",
  channelResourceId: "test-resource-id",
  channelResourceUri: "test-resource-uri",
  channelExpiration: new Date(Date.now() + 86400000),
  syncSubscribedAt: new Date(),
  syncSubscribedErrorAt: null,
  syncSubscribedErrorCount: 0,
  syncToken: "test-sync-token",
  syncedAt: new Date(),
  syncErrorAt: null,
  syncErrorCount: 0,
};

const _mockCredential = {
  id: 1,
  key: { access_token: "test-token" },
  user: { email: "test@example.com" },
  delegatedTo: null,
};

function ok(body: unknown, status = 200) {
  return { ok: true, status, json: async () => body, text: async () => "" } as unknown as Response;
}
function fail(status: number) {
  return {
    ok: false,
    status,
    statusText: "x",
    json: async () => ({}),
    text: async () => "",
  } as unknown as Response;
}

describe("Office365CalendarSubscriptionAdapter (WC-TW-2 renew)", () => {
  const fetchMock = vi.fn();
  let adapter: Office365CalendarSubscriptionAdapter;
  beforeEach(() => {
    process.env.MICROSOFT_WEBHOOK_URL = "https://example.test/hook";
    process.env.MICROSOFT_WEBHOOK_TOKEN = "tok";
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    adapter = new Office365CalendarSubscriptionAdapter({ getAccessToken: async () => "access" });
  });
  afterEach(() => vi.unstubAllGlobals());
  const cred = { ..._mockCredential, key: "access" } as never;

  test("renews an unexpired subscription with PATCH", async () => {
    const exp = new Date(Date.now() + 3 * 86400000).toISOString();
    fetchMock.mockResolvedValueOnce(ok({ id: "test-channel-id", resource: "r", expirationDateTime: exp }));
    const res = await adapter.subscribe(_mockSelectedCalendar, cred);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("PATCH");
    expect(String(url)).toContain("/subscriptions/test-channel-id");
    expect(Object.keys(JSON.parse(init.body))).toEqual(["expirationDateTime"]);
    expect(res.id).toBe("test-channel-id");
    expect(res.expiration?.toISOString()).toBe(exp);
  });

  test("falls back to POST when PATCH returns 404", async () => {
    fetchMock
      .mockResolvedValueOnce(fail(404))
      .mockResolvedValueOnce(
        ok({ id: "new-id", resource: "r", expirationDateTime: new Date().toISOString() })
      );
    const res = await adapter.subscribe(_mockSelectedCalendar, cred);
    expect(fetchMock.mock.calls.map((c) => c[1].method)).toEqual(["PATCH", "POST"]);
    expect(res.id).toBe("new-id");
  });

  test("does not swallow non-404 renew errors", async () => {
    fetchMock.mockResolvedValueOnce(fail(500));
    await expect(adapter.subscribe(_mockSelectedCalendar, cred)).rejects.toThrow("Graph 500");
  });

  test("creates with POST when there is no live subscription", async () => {
    fetchMock.mockResolvedValueOnce(
      ok({ id: "n", resource: "r", expirationDateTime: new Date().toISOString() })
    );
    await adapter.subscribe({ ..._mockSelectedCalendar, channelId: null, channelExpiration: null }, cred);
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });

  test("unsubscribe deletes by subscription id (channelId)", async () => {
    fetchMock.mockResolvedValueOnce(ok({}, 204));
    await adapter.unsubscribe(_mockSelectedCalendar, cred);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/subscriptions/test-channel-id");
  });
});

describe("Office365CalendarSubscriptionAdapter auth (WC-TW-2 wire)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    process.env.MICROSOFT_WEBHOOK_URL = "https://example.test/hook";
    process.env.MICROSOFT_WEBHOOK_TOKEN = "tok";
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  test("sends the refreshed OAuth access token as Bearer, never the raw credential.key", async () => {
    const getAccessToken = vi.fn().mockResolvedValue("fresh-access");
    const adapter = new Office365CalendarSubscriptionAdapter({ getAccessToken });
    fetchMock.mockResolvedValueOnce(
      ok({ value: [], "@odata.deltaLink": "https://graph.microsoft.com/v1.0/d" })
    );
    await adapter.fetchEvents(_mockSelectedCalendar, _mockCredential as never);
    expect(getAccessToken).toHaveBeenCalledWith(_mockCredential);
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer fresh-access");
    expect(headers.Prefer).toBe('outlook.timezone="UTC"');
  });
});

describe("Office365CalendarSubscriptionAdapter fetchEvents (WC-TW-2 delta)", () => {
  const fetchMock = vi.fn();
  let adapter: Office365CalendarSubscriptionAdapter;
  const cred = { ..._mockCredential } as never;
  const base = "https://graph.microsoft.com/v1.0";
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    adapter = new Office365CalendarSubscriptionAdapter({ getAccessToken: async () => "access" });
  });
  afterEach(() => vi.unstubAllGlobals());

  const busyEvent = {
    id: "e1",
    iCalUId: "ical-1",
    subject: "Busy",
    showAs: "busy",
    start: { dateTime: "2030-01-02T09:00:00.0000000", timeZone: "UTC" },
    end: { dateTime: "2030-01-02T10:00:00.0000000", timeZone: "UTC" },
    seriesMasterId: "master-1",
    createdDateTime: "2029-12-01T00:00:00Z",
    lastModifiedDateTime: "2029-12-02T00:00:00Z",
  };

  test("first sync walks calendarView/delta over the cache window and stores the deltaLink as syncToken", async () => {
    fetchMock
      .mockResolvedValueOnce(
        ok({ value: [busyEvent], "@odata.nextLink": `${base}/me/calendarView/delta?$skiptoken=p2` })
      )
      .mockResolvedValueOnce(
        ok({ value: [], "@odata.deltaLink": `${base}/me/calendarView/delta?$deltatoken=d1` })
      );
    const res = await adapter.fetchEvents({ ..._mockSelectedCalendar, syncToken: null }, cred);

    const first = new URL(String(fetchMock.mock.calls[0][0]));
    expect(first.pathname).toBe(
      `/v1.0/me/calendars/${encodeURIComponent("test@example.com")}/calendarView/delta`
    );
    const start = new Date(first.searchParams.get("startDateTime") as string);
    const end = new Date(first.searchParams.get("endDateTime") as string);
    expect(end.getTime() - start.getTime()).toBeGreaterThan(80 * 86400000);
    expect(String(fetchMock.mock.calls[1][0])).toBe(`${base}/me/calendarView/delta?$skiptoken=p2`);
    expect(res.provider).toBe("office365_calendar");
    const stored = Office365CalendarSubscriptionAdapter.decodeSyncToken(res.syncToken);
    expect(stored?.deltaLink).toBe(`${base}/me/calendarView/delta?$deltatoken=d1`);
    expect(stored?.windowEnd.toISOString()).toBe(end.toISOString());
    expect(res.fullResync).toBeUndefined();
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      id: "e1",
      iCalUID: "ical-1",
      busy: true,
      status: "confirmed",
      recurringEventId: "master-1",
    });
    expect(res.items[0].start?.toISOString()).toBe("2030-01-02T09:00:00.000Z");
    expect(res.items[0].end?.toISOString()).toBe("2030-01-02T10:00:00.000Z");
  });

  const daysFromNow = (days: number) => new Date(Date.now() + days * 86400000);
  const encode = (link: string, windowEnd: Date) =>
    Office365CalendarSubscriptionAdapter.encodeSyncToken(link, windowEnd);

  test("fresh window: incremental sync reuses the stored deltaLink and keeps the window end", async () => {
    const windowEnd = daysFromNow(88);
    fetchMock.mockResolvedValueOnce(
      ok({ value: [], "@odata.deltaLink": `${base}/me/calendarView/delta?$deltatoken=d2` })
    );
    const res = await adapter.fetchEvents(
      {
        ..._mockSelectedCalendar,
        syncToken: encode(`${base}/me/calendarView/delta?$deltatoken=d1`, windowEnd),
      },
      cred
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${base}/me/calendarView/delta?$deltatoken=d1`);
    expect(res.fullResync).toBeUndefined();
    const stored = Office365CalendarSubscriptionAdapter.decodeSyncToken(res.syncToken);
    expect(stored?.deltaLink).toBe(`${base}/me/calendarView/delta?$deltatoken=d2`);
    expect(stored?.windowEnd.toISOString()).toBe(windowEnd.toISOString());
  });

  test("stale window: a window end > 7 days behind the cache horizon starts a new round flagged fullResync", async () => {
    fetchMock.mockResolvedValueOnce(ok({ value: [busyEvent], "@odata.deltaLink": `${base}/d-rolled` }));
    const res = await adapter.fetchEvents(
      { ..._mockSelectedCalendar, syncToken: encode(`${base}/d-old`, daysFromNow(60)) },
      cred
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const first = new URL(String(fetchMock.mock.calls[0][0]));
    expect(first.pathname).toContain("/calendarView/delta");
    const end = new Date(first.searchParams.get("endDateTime") as string);
    expect(end.getTime()).toBeGreaterThan(daysFromNow(85).getTime());
    expect(res.fullResync).toBe(true);
    const stored = Office365CalendarSubscriptionAdapter.decodeSyncToken(res.syncToken);
    expect(stored?.deltaLink).toBe(`${base}/d-rolled`);
    expect(stored?.windowEnd.toISOString()).toBe(end.toISOString());
  });

  test("legacy bare deltaLink is treated as stale: new round flagged fullResync", async () => {
    fetchMock.mockResolvedValueOnce(ok({ value: [], "@odata.deltaLink": `${base}/d-new` }));
    const res = await adapter.fetchEvents(
      { ..._mockSelectedCalendar, syncToken: `${base}/me/calendarView/delta?$deltatoken=legacy` },
      cred
    );
    expect(String(fetchMock.mock.calls[0][0])).toContain("/calendarView/delta?startDateTime=");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("legacy");
    expect(res.fullResync).toBe(true);
    expect(Office365CalendarSubscriptionAdapter.decodeSyncToken(res.syncToken)?.deltaLink).toBe(
      `${base}/d-new`
    );
  });

  test("decodeSyncToken rejects bare links, bad JSON, wrong version and invalid dates", () => {
    expect(Office365CalendarSubscriptionAdapter.decodeSyncToken(null)).toBeNull();
    expect(Office365CalendarSubscriptionAdapter.decodeSyncToken(`${base}/d`)).toBeNull();
    expect(Office365CalendarSubscriptionAdapter.decodeSyncToken("{not json")).toBeNull();
    expect(
      Office365CalendarSubscriptionAdapter.decodeSyncToken(
        JSON.stringify({ v: 2, windowEnd: new Date().toISOString(), deltaLink: "x" })
      )
    ).toBeNull();
    expect(
      Office365CalendarSubscriptionAdapter.decodeSyncToken(
        JSON.stringify({ v: 1, windowEnd: "nope", deltaLink: "x" })
      )
    ).toBeNull();
  });

  test("410 on a fresh stored deltaLink triggers a full window resync flagged fullResync", async () => {
    fetchMock
      .mockResolvedValueOnce(fail(410))
      .mockResolvedValueOnce(ok({ value: [busyEvent], "@odata.deltaLink": `${base}/d-new` }));
    const res = await adapter.fetchEvents(
      { ..._mockSelectedCalendar, syncToken: encode(`${base}/d-old`, daysFromNow(88)) },
      cred
    );
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${base}/d-old`);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/calendarView/delta?startDateTime=");
    expect(res.fullResync).toBe(true);
    expect(Office365CalendarSubscriptionAdapter.decodeSyncToken(res.syncToken)?.deltaLink).toBe(
      `${base}/d-new`
    );
  });

  test("non-410 errors propagate", async () => {
    fetchMock.mockResolvedValueOnce(fail(500));
    await expect(adapter.fetchEvents(_mockSelectedCalendar, cred)).rejects.toThrow("Graph 500");
  });

  test("@removed and free/workingElsewhere events are non-busy; tentative/oof count as busy", async () => {
    fetchMock.mockResolvedValueOnce(
      ok({
        value: [
          { id: "gone", "@removed": { reason: "deleted" } },
          { ...busyEvent, id: "free", showAs: "free" },
          { ...busyEvent, id: "we", showAs: "workingElsewhere" },
          { ...busyEvent, id: "tent", showAs: "tentative" },
          { ...busyEvent, id: "oof", showAs: "oof" },
          { ...busyEvent, id: "cxl", isCancelled: true },
        ],
        "@odata.deltaLink": `${base}/d`,
      })
    );
    const res = await adapter.fetchEvents(_mockSelectedCalendar, cred);
    const byId = Object.fromEntries(res.items.map((i) => [i.id, i]));
    expect(byId.gone).toMatchObject({ busy: false, status: "cancelled" });
    expect(byId.free.busy).toBe(false);
    expect(byId.we.busy).toBe(false);
    expect(byId.tent.busy).toBe(true);
    expect(byId.oof.busy).toBe(true);
    expect(byId.cxl.status).toBe("cancelled");
  });
});
