import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

import { Office365CalendarSubscriptionAdapter } from "../Office365CalendarSubscription.adapter";

import type { SelectedCalendar } from "@calcom/prisma/client";

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
  return { ok: false, status, statusText: "x", json: async () => ({}), text: async () => "" } as unknown as Response;
}

describe("Office365CalendarSubscriptionAdapter (WC-TW-2 renew)", () => {
  const fetchMock = vi.fn();
  let adapter: Office365CalendarSubscriptionAdapter;
  beforeEach(() => {
    process.env.MICROSOFT_WEBHOOK_URL = "https://example.test/hook";
    process.env.MICROSOFT_WEBHOOK_TOKEN = "tok";
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    adapter = new Office365CalendarSubscriptionAdapter();
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
      .mockResolvedValueOnce(ok({ id: "new-id", resource: "r", expirationDateTime: new Date().toISOString() }));
    const res = await adapter.subscribe(_mockSelectedCalendar, cred);
    expect(fetchMock.mock.calls.map((c) => c[1].method)).toEqual(["PATCH", "POST"]);
    expect(res.id).toBe("new-id");
  });

  test("does not swallow non-404 renew errors", async () => {
    fetchMock.mockResolvedValueOnce(fail(500));
    await expect(adapter.subscribe(_mockSelectedCalendar, cred)).rejects.toThrow("Graph 500");
  });

  test("creates with POST when there is no live subscription", async () => {
    fetchMock.mockResolvedValueOnce(ok({ id: "n", resource: "r", expirationDateTime: new Date().toISOString() }));
    await adapter.subscribe({ ..._mockSelectedCalendar, channelId: null, channelExpiration: null }, cred);
    expect(fetchMock.mock.calls[0][1].method).toBe("POST");
  });

  test("unsubscribe deletes by subscription id (channelId)", async () => {
    fetchMock.mockResolvedValueOnce(ok({}, 204));
    await adapter.unsubscribe(_mockSelectedCalendar, cred);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/subscriptions/test-channel-id");
  });
});
