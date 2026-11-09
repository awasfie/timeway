import { timingSafeEqual } from "node:crypto";
import process from "node:process";
import type { CalendarSubscriptionProvider } from "@calcom/features/calendar-subscription/adapters/AdaptersFactory";
import { STALE_AFTER_MS } from "@calcom/features/calendar-subscription/lib/reconcile/CalendarReconciliationService";
import { renderSyncMetrics } from "@calcom/features/calendar-subscription/lib/telemetry/syncMetrics";
import { SelectedCalendarRepository } from "@calcom/features/selectedCalendar/repositories/SelectedCalendarRepository";
import { withTwPlatformJob } from "@calcom/lib/server/tw-org-scope/unattended";
import { prisma } from "@calcom/prisma";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Every provider with an adapter, not only the subscribed ones, so a provider that never syncs shows as 0.
const PROVIDERS: CalendarSubscriptionProvider[] = ["google_calendar", "office365_calendar"];
const EXPIRING_WINDOW_MS = 60 * 60 * 1000;

function authorized(request: NextRequest): boolean {
  const expected = process.env.TIMEWAY_METRICS_TOKEN;
  if (!expected) return false;
  const given = request.headers.get("authorization") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * WC-TW-3 step 3: Prometheus scrape target for the calendar sync dashboard.
 * Closed (404) unless TIMEWAY_METRICS_TOKEN is set and sent as a bearer token.
 */
async function handler(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ message: "Not found" }, { status: 404 });
  }

  const now = new Date();
  let health: Awaited<ReturnType<SelectedCalendarRepository["countSubscriptionHealth"]>> = [];
  let healthUp = 1;
  try {
    health = await new SelectedCalendarRepository(prisma).countSubscriptionHealth({
      integrations: PROVIDERS,
      staleBefore: new Date(now.getTime() - STALE_AFTER_MS),
      now,
      expiringBefore: new Date(now.getTime() + EXPIRING_WINDOW_MS),
    });
  } catch {
    healthUp = 0;
  }

  const body =
    renderSyncMetrics(health) +
    "# HELP timeway_sync_metrics_db_up 1 if the scrape-time database gauges were read.\n" +
    "# TYPE timeway_sync_metrics_db_up gauge\n" +
    `timeway_sync_metrics_db_up ${healthUp}\n`;

  return new NextResponse(body, {
    status: 200,
    headers: { "content-type": "text/plain; version=0.0.4; charset=utf-8", "cache-control": "no-store" },
  });
}

// TW-T9.2b4: secret-gated, reads across orgs, so it runs under a named platform scope.
export const GET = withTwPlatformJob("calendar-sync-metrics", handler);
