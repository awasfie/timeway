import { beforeEach, describe, expect, test, vi } from "vitest";

const countSubscriptionHealth = vi.fn();

vi.mock("@calcom/prisma", () => ({ prisma: {} }));
vi.mock("@calcom/features/selectedCalendar/repositories/SelectedCalendarRepository", () => ({
  SelectedCalendarRepository: class {
    countSubscriptionHealth = countSubscriptionHealth;
  },
}));
vi.mock("@calcom/features/calendar-subscription/lib/reconcile/CalendarReconciliationService", () => ({
  STALE_AFTER_MS: 15 * 60 * 1000,
}));
vi.mock("next/server", () => {
  class MockNextResponse {
    status: number;
    headers: Map<string, string>;
    constructor(
      public body: string,
      init: { status?: number; headers?: Record<string, string> } = {}
    ) {
      this.status = init.status ?? 200;
      this.headers = new Map(Object.entries(init.headers ?? {}));
    }
    async text() {
      return this.body;
    }
    static json(body: unknown, init: { status?: number } = {}) {
      return new MockNextResponse(JSON.stringify(body), init);
    }
  }
  return { NextResponse: MockNextResponse };
});

import {
  observeSyncLag,
  resetSyncMetrics,
} from "@calcom/features/calendar-subscription/lib/telemetry/syncMetrics";
import type { NextRequest } from "next/server";
import { GET } from "../route";

const request = (authorization?: string) =>
  ({
    headers: { get: (k: string) => (k.toLowerCase() === "authorization" ? (authorization ?? null) : null) },
  }) as unknown as NextRequest;

describe("/api/metrics/calendar-sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    resetSyncMetrics();
    countSubscriptionHealth.mockResolvedValue([
      { provider: "google_calendar", stale: 3, channelsExpired: 1, channelsExpiringWithin1h: 2 },
      { provider: "office365_calendar", stale: 0, channelsExpired: 0, channelsExpiringWithin1h: 0 },
    ]);
  });

  test("404 when no token is configured, even with a bearer header", async () => {
    const res = await GET(request("Bearer anything"));
    expect(res.status).toBe(404);
    expect(countSubscriptionHealth).not.toHaveBeenCalled();
  });

  test("404 on a wrong token", async () => {
    vi.stubEnv("TIMEWAY_METRICS_TOKEN", "scrape-secret");
    expect((await GET(request("Bearer wrong"))).status).toBe(404);
    expect((await GET(request())).status).toBe(404);
  });

  test("serves Prometheus text with process series and scrape-time gauges", async () => {
    vi.stubEnv("TIMEWAY_METRICS_TOKEN", "scrape-secret");
    observeSyncLag("google_calendar", 20);
    const res = await GET(request("Bearer scrape-secret"));
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain; version=0.0.4");
    expect(body).toContain('timeway_sync_lag_seconds_count{provider="google_calendar"} 1');
    expect(body).toContain('timeway_stale_calendars{provider="google_calendar"} 3');
    expect(body).toContain(
      'timeway_calendar_channels_expiring{provider="google_calendar",window="expired"} 1'
    );
    expect(body).toContain("timeway_sync_metrics_db_up 1");

    const args = countSubscriptionHealth.mock.calls[0][0];
    expect(args.integrations).toEqual(["google_calendar", "office365_calendar"]);
    expect(args.now.getTime() - args.staleBefore.getTime()).toBe(15 * 60 * 1000);
    expect(args.expiringBefore.getTime() - args.now.getTime()).toBe(60 * 60 * 1000);
  });

  test("still serves process series when the database read fails", async () => {
    vi.stubEnv("TIMEWAY_METRICS_TOKEN", "scrape-secret");
    countSubscriptionHealth.mockRejectedValue(new Error("db down"));
    const res = await GET(request("Bearer scrape-secret"));
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(body).toContain("timeway_sync_metrics_db_up 0");
    expect(body).not.toContain("timeway_stale_calendars{");
  });
});
