/**
 * WC-TW-4f: route-level proof that a real Graph change notification (a real `Request` whose body
 * is a stream carrying `{ value: [...] }`) passes clientState validation and reaches processEvents,
 * and that a wrong clientState is rejected. The service is real; only I/O edges are mocked.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const TOKEN = "wc-tw-4f-test-token";

const findByChannelId = vi.fn();

vi.mock("next/server", () => ({
  // no `after` outside a Next request scope: the route then awaits the work inline
  after: undefined,
  NextResponse: {
    json: vi.fn((body: unknown, init?: { status?: number }) => ({
      json: async () => body,
      status: init?.status ?? 200,
    })),
  },
}));
vi.mock("@calcom/prisma", () => ({ prisma: {} }));
vi.mock("@sentry/nextjs", () => ({ metrics: { count: vi.fn(), distribution: vi.fn() } }));
vi.mock("@calcom/features/selectedCalendar/repositories/SelectedCalendarRepository", () => ({
  SelectedCalendarRepository: class {
    findByChannelId = findByChannelId;
  },
}));
vi.mock("@calcom/features/bookings/repositories/BookingRepository", () => ({ BookingRepository: class {} }));
vi.mock("@calcom/features/calendar-subscription/lib/cache/CalendarCacheEventRepository", () => ({
  CalendarCacheEventRepository: class {},
}));
vi.mock("@calcom/features/calendar-subscription/lib/cache/CalendarCacheEventService", () => ({
  CalendarCacheEventService: class {},
}));
vi.mock("@calcom/features/calendar-subscription/lib/sync/CalendarSyncService", () => ({
  CalendarSyncService: class {},
}));
vi.mock("@calcom/features/di/containers/FeatureRepository", () => ({ getFeatureRepository: () => ({}) }));
vi.mock("@calcom/features/di/containers/TeamFeatureRepository", () => ({
  getTeamFeatureRepository: () => ({}),
}));
vi.mock("@calcom/features/di/containers/UserFeatureRepository", () => ({
  getUserFeatureRepository: () => ({}),
}));

import { CalendarSubscriptionService } from "@calcom/features/calendar-subscription/lib/CalendarSubscriptionService";

const URL_O365 = "https://timeway.example/api/webhooks/calendar-subscription/office365_calendar";

function graphRequest(value: unknown[]): Request {
  return new Request(URL_O365, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
}

function notification(subscriptionId: string, clientState: string) {
  return {
    subscriptionId,
    clientState,
    changeType: "created",
    resource: "Users/u/Events/AAMk",
    subscriptionExpirationDateTime: "2026-10-24T19:04:00Z",
    tenantId: "tenant",
  };
}

describe("WC-TW-4f Graph change notifications through the real route", () => {
  let processEvents: ReturnType<typeof vi.spyOn>;
  const prevToken = process.env.MICROSOFT_WEBHOOK_TOKEN;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.MICROSOFT_WEBHOOK_TOKEN = TOKEN;
    vi.spyOn(CalendarSubscriptionService.prototype, "isCacheEnabled").mockResolvedValue(true);
    vi.spyOn(CalendarSubscriptionService.prototype, "isSyncEnabled").mockResolvedValue(false);
    processEvents = vi
      .spyOn(CalendarSubscriptionService.prototype, "processEvents")
      .mockResolvedValue({ eventsFetched: 1, eventsCached: 1, eventsSynced: 0 } as never);
    findByChannelId.mockImplementation(async (id: string) =>
      id === "sub-o1" ? { id: "sc-7", channelId: "sub-o1", integration: "office365_calendar" } : null
    );
  });

  afterEach(() => {
    process.env.MICROSOFT_WEBHOOK_TOKEN = prevToken;
    vi.restoreAllMocks();
  });

  test("valid clientState in the JSON body is accepted and the calendar is processed once (202)", async () => {
    const { POST } = await import("../route");
    const req = graphRequest([notification("sub-o1", TOKEN), notification("sub-o1", TOKEN)]);
    expect(req.body).toBeInstanceOf(ReadableStream);

    const res = await POST(req as never, { params: Promise.resolve({ provider: "office365_calendar" }) });

    expect(res.status).toBe(202);
    expect(findByChannelId).toHaveBeenCalledTimes(1);
    expect(findByChannelId).toHaveBeenCalledWith("sub-o1");
    expect(processEvents).toHaveBeenCalledTimes(1);
    expect(processEvents.mock.calls[0][0]).toMatchObject({ id: "sc-7" });
  });

  test("invalid clientState is rejected: no lookup, no processing", async () => {
    const { POST } = await import("../route");
    const res = await POST(graphRequest([notification("sub-o1", "wrong-token")]) as never, {
      params: Promise.resolve({ provider: "office365_calendar" }),
    });

    expect(res.status).toBe(202);
    expect(findByChannelId).not.toHaveBeenCalled();
    expect(processEvents).not.toHaveBeenCalled();
  });

  test("mixed batch: only the valid entry is processed", async () => {
    const svc = new CalendarSubscriptionService({
      selectedCalendarRepository: { findByChannelId },
    } as never);
    const r = await svc.processGraphNotifications(
      [notification("sub-o1", TOKEN), notification("sub-o2", "nope"), { clientState: TOKEN }],
      TOKEN
    );
    expect(r).toEqual({ processed: 1, invalid: 2, notFound: 0, failed: 0 });
    expect(processEvents).toHaveBeenCalledTimes(1);
  });

  test("missing MICROSOFT_WEBHOOK_TOKEN rejects every notification", async () => {
    const svc = new CalendarSubscriptionService({
      selectedCalendarRepository: { findByChannelId },
    } as never);
    const r = await svc.processGraphNotifications([notification("sub-o1", TOKEN)], undefined);
    expect(r.invalid).toBe(1);
    expect(processEvents).not.toHaveBeenCalled();
  });

  test("google_calendar keeps the header-based processWebhook path", async () => {
    const processWebhook = vi
      .spyOn(CalendarSubscriptionService.prototype, "processWebhook")
      .mockResolvedValue(null);
    const { POST } = await import("../route");
    const req = new Request("https://timeway.example/api/webhooks/calendar-subscription/google_calendar", {
      method: "POST",
    });
    const res = await POST(req as never, { params: Promise.resolve({ provider: "google_calendar" }) });
    expect(res.status).toBe(200);
    expect(processWebhook).toHaveBeenCalledWith("google_calendar", req);
  });
});
