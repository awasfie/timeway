import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { withTwPlatformJob } from "@calcom/lib/server/tw-org-scope/unattended";
import { CalendarCacheEventRepository } from "@calcom/features/calendar-subscription/lib/cache/CalendarCacheEventRepository";
import { CalendarCacheEventService } from "@calcom/features/calendar-subscription/lib/cache/CalendarCacheEventService";
import { prisma } from "@calcom/prisma";
import { defaultResponderForAppDir } from "@calcom/web/app/api/defaultResponderForAppDir";
import { isCronAuthorized } from "@calcom/lib/server/cronAuth";

/**
 * Cron webhook
 * Cleanup stale calendar cache
 *
 * @param request
 * @returns
 */
async function getHandler(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ message: "Forbidden" }, { status: 403 });
  }

  // instantiate dependencies
  const calendarCacheEventRepository = new CalendarCacheEventRepository(prisma);
  const calendarCacheEventService = new CalendarCacheEventService({
    calendarCacheEventRepository,
  });

  try {
    await calendarCacheEventService.cleanupStaleCache();
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Unknown error";
    console.error(`[calendar-subscriptions-cleanup] ${message}:`, e);
    return NextResponse.json({ message }, { status: 500 });
  }
}

// TW-T9.2b3: cross-org job, platform scope "calendar-subscriptions-cleanup".
export const GET = defaultResponderForAppDir(withTwPlatformJob("calendar-subscriptions-cleanup", getHandler));
