import dayjs from "@calcom/dayjs";
import { getUsernameList } from "@calcom/features/eventtypes/lib/defaultEvents";
import { getRoutedTeamMemberIdsFromSearchParams } from "@calcom/lib/bookings/getRoutedTeamMemberIdsFromSearchParams";
import { isBookingDryRun } from "@calcom/features/bookings/Booker/utils/isBookingDryRun";
import { BOOKER_NUMBER_OF_DAYS_TO_LOAD } from "@calcom/lib/constants";
import type { TGetScheduleInputSchema } from "@calcom/trpc/server/routers/viewer/slots/types";

export type RawScheduleInput = Omit<TGetScheduleInputSchema, "duration"> & { duration?: string };

const MONTH_VIEW = "month_view";

export const getMultipleDurationValue = (
  multipleDurationConfig: number[] | undefined,
  queryDuration: string | string[] | null | undefined,
  defaultValue: number
) => {
  if (!multipleDurationConfig) return null;
  if (multipleDurationConfig.includes(Number(queryDuration))) return Number(queryDuration);
  return defaultValue;
};

/** Mirrors the Booker store init: `month` param > `date` param month > current month. */
export function getInitialMonth(searchParams: URLSearchParams, timeZone: string, now = dayjs()): string | null {
  const month = searchParams.get("month");
  if (month) return month;
  const date = searchParams.get("date");
  if (date && dayjs(date).isValid()) return dayjs(date).format("YYYY-MM");
  return now.tz(timeZone).format("YYYY-MM");
}

/**
 * Mirrors useTimesForSchedule for month view / mobile with no selected-time state. Month view widens
 * endTime to the next month once we are past the first two weeks of the current month (the "15th" rule).
 * Boundaries are computed in the invitee timezone, which is the browser-local zone the client uses.
 */
export function getInitialScheduleTimes(month: string, timeZone: string, now = dayjs()): [string, string] | null {
  const monthStart = dayjs.tz(`${month}-01`, timeZone);
  if (!monthStart.isValid() || !/^\d{4}-\d{2}$/.test(month)) return null;
  const nowTz = now.tz(timeZone);
  const prefetchNextMonth =
    nowTz.isAfter(monthStart.add(2, "week")) && nowTz.format("YYYY-MM") === monthStart.format("YYYY-MM");
  const last = prefetchNextMonth ? monthStart.add(1, "month") : monthStart;
  return [monthStart.startOf("month").toISOString(), last.endOf("month").toISOString()];
}

export type InitialSlotsParams = {
  user: string;
  slug: string;
  searchParams: URLSearchParams;
  /** cal.tz > cf-timezone > event schedule timezone */
  timeZone: string;
  /** Zone the invitee browser is assumed to run in (cf-timezone, else the event timezone). */
  browserTimeZone: string;
  orgSlug?: string | null;
  duration: number | null;
  isTeamEvent: boolean;
  defaultLayout?: string | null;
  now?: ReturnType<typeof dayjs>;
};

/** Builds the EXACT input useSchedule sends; any difference changes the react-query key and refetches. */
export function buildInitialScheduleInput(p: InitialSlotsParams): RawScheduleInput | null {
  const sp = p.searchParams;
  if (p.isTeamEvent) return null;
  if (sp.get("cal.skipSlotsFetch") === "true") return null;
  if (BOOKER_NUMBER_OF_DAYS_TO_LOAD > 0) return null;
  if ((p.defaultLayout ?? MONTH_VIEW) !== MONTH_VIEW) return null;

  const month = getInitialMonth(sp, p.browserTimeZone, p.now);
  if (!month) return null;
  const times = getInitialScheduleTimes(month, p.browserTimeZone, p.now);
  if (!times) return null;

  const queuedFormResponseId = sp.get("cal.queuedFormResponseId");
  return {
    isTeamEvent: false,
    usernameList: getUsernameList(p.user),
    eventTypeSlug: p.slug,
    startTime: times[0],
    endTime: times[1],
    timeZone: p.timeZone,
    duration: p.duration ? `${p.duration}` : undefined,
    rescheduleUid: sp.get("rescheduleUid"),
    ...(p.orgSlug ? { orgSlug: p.orgSlug } : {}),
    routedTeamMemberIds: getRoutedTeamMemberIdsFromSearchParams(new URLSearchParams(sp.toString())),
    skipContactOwner: sp.get("cal.skipContactOwner") === "true",
    ...(queuedFormResponseId ? { queuedFormResponseId } : {}),
    email: sp.get("email"),
    embedConnectVersion: sp.get("cal.embed.connectVersion") || "0",
    _isDryRun: isBookingDryRun(sp),
  } as RawScheduleInput;
}
