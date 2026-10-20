import { getCredentialForSelectedCalendar } from "@calcom/app-store/delegationCredential";
import { DefaultAdapterFactory } from "@calcom/features/calendar-subscription/adapters/AdaptersFactory";
import { CalendarSubscriptionService } from "@calcom/features/calendar-subscription/lib/CalendarSubscriptionService";
import { CalendarCacheEventRepository } from "@calcom/features/calendar-subscription/lib/cache/CalendarCacheEventRepository";
import { CalendarCacheEventService } from "@calcom/features/calendar-subscription/lib/cache/CalendarCacheEventService";
import { CalendarReconciliationService } from "@calcom/features/calendar-subscription/lib/reconcile/CalendarReconciliationService";
import { getFeatureRepository } from "@calcom/features/di/containers/FeatureRepository";
import { SelectedCalendarRepository } from "@calcom/features/selectedCalendar/repositories/SelectedCalendarRepository";
import { isCronAuthorized } from "@calcom/lib/server/cronAuth";
import { prisma } from "@calcom/prisma";
import { defaultResponderForAppDir } from "@calcom/web/app/api/defaultResponderForAppDir";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Cron webhook (WC-TW-3)
 * Reconciles the calendar cache against the provider.
 * - default: nightly full reconciliation of every subscribed calendar
 * - ?mode=stale: only calendars whose cache is older than 15 min (run every few minutes)
 */
async function getHandler(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  const featureRepository = getFeatureRepository();
  const cacheEnabled = await featureRepository.checkIfFeatureIsEnabledGlobally(
    CalendarSubscriptionService.CALENDAR_SUBSCRIPTION_CACHE_FEATURE
  );
  if (!cacheEnabled) {
    return NextResponse.json({ ok: true, skipped: "cache disabled" });
  }

  const calendarCacheEventRepository = new CalendarCacheEventRepository(prisma);
  const service = new CalendarReconciliationService({
    adapterFactory: new DefaultAdapterFactory(),
    selectedCalendarRepository: new SelectedCalendarRepository(prisma),
    calendarCacheEventRepository,
    calendarCacheEventService: new CalendarCacheEventService({ calendarCacheEventRepository }),
    getCredential: getCredentialForSelectedCalendar,
  });

  try {
    const stale = request.nextUrl.searchParams.get("mode") === "stale";
    const result = stale ? await service.reconcileStale() : await service.reconcileAll();
    return NextResponse.json({ ok: true, mode: stale ? "stale" : "nightly", ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ message }, { status: 500 });
  }
}

export const GET = defaultResponderForAppDir(getHandler);
