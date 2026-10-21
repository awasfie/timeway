import { RRule } from "rrule";

import type { Dayjs } from "@calcom/dayjs";
import dayjs from "@calcom/dayjs";
import { detectBrowserTimeFormat, TimeFormat } from "@calcom/lib/timeFormat";
import type { RecurringEvent } from "@calcom/types/Calendar";

import { parseZone } from "./parse-zone";
import { wallClockParts, wallClockToInstant } from "./timeZoneWallClock";

type ExtraOptions = { withDefaultTimeFormat?: boolean; selectedTimeFormat?: TimeFormat };

const processDate = (
  date: string | null | Dayjs,
  language: string,
  timeZone: string,
  options?: ExtraOptions
) => {
  const parsedZone = parseZone(date);
  if (!parsedZone?.isValid()) return "Invalid date";
  const formattedTime = parsedZone?.format(
    options?.withDefaultTimeFormat
      ? TimeFormat.TWELVE_HOUR
      : options?.selectedTimeFormat || detectBrowserTimeFormat
  );
  return `${formattedTime}, ${dayjs(date)
    .toDate()
    .toLocaleString(language, { dateStyle: "full", timeZone })}`;
};

export const parseDate = (
  date: string | null | Dayjs,
  language: string,
  timeZone: string,
  options?: ExtraOptions
) => {
  if (!date) return ["No date"];
  return processDate(date, language, timeZone, options);
};

const timeOptions: Intl.DateTimeFormatOptions = {
  hour12: true,
  hourCycle: "h12",
  hour: "numeric",
  minute: "numeric",
};

const dateOptions: Intl.DateTimeFormatOptions = {
  weekday: "long",
  year: "numeric",
  month: "long",
  day: "numeric",
};

export const parseDateTimeWithTimeZone = (
  date: Date,
  language: string,
  timezone: string,
  options?: ExtraOptions
): string => {
  timeOptions.timeZone = timezone;
  dateOptions.timeZone = timezone;

  if (options?.withDefaultTimeFormat) {
    timeOptions.hourCycle = "h12";
  } else if (options?.selectedTimeFormat) {
    timeOptions.hourCycle = options.selectedTimeFormat === TimeFormat.TWELVE_HOUR ? "h12" : "h24";
    if (timeOptions.hourCycle === "h24") {
      delete timeOptions.hour12;
    }
  }
  const formattedDate = new Date(date).toLocaleDateString(language, dateOptions);
  const formattedTime = new Date(date)
    .toLocaleTimeString(language, timeOptions)
    .replace(" ", "")
    .toLowerCase();
  return `${formattedTime}, ${formattedDate}`;
};

export const parseRecurringDates = (
  {
    startDate,
    timeZone,
    recurringEvent,
    recurringCount,
    selectedTimeFormat,
    withDefaultTimeFormat,
  }: {
    startDate: string | null | Dayjs;
    timeZone: string;
    recurringEvent: RecurringEvent | null;
    recurringCount: number;
    selectedTimeFormat?: TimeFormat;
    withDefaultTimeFormat?: boolean;
  },
  language: string
): [string[], Date[]] => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { count, ...restRecurringEvent } = recurringEvent || {};
  // RFC 5545: occurrences repeat DTSTART's wall clock in DTSTART's zone, which for a booking is the time the
  // booker picked in the booker's timeZone. rrule works in UTC, so expand a floating (UTC-as-wall-clock)
  // start and map each occurrence back through timeZone; independent of the runtime's own TZ.
  const startMs = dayjs(startDate).valueOf();
  const startWall = wallClockParts(startMs, timeZone);
  const rule = new RRule({
    ...restRecurringEvent,
    count: recurringCount,
    dtstart: new Date(
      Date.UTC(
        startWall.year,
        startWall.month - 1,
        startWall.day,
        startWall.hour,
        startWall.minute,
        startWall.second
      )
    ),
  });

  const times = rule.all().map((t) => {
    const minutesOfDay = t.getUTCHours() * 60 + t.getUTCMinutes();
    const instant = wallClockToInstant(
      { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() },
      minutesOfDay,
      timeZone,
      "earlier"
    );
    return dayjs.utc(instant + t.getUTCSeconds() * 1000 + (startMs % 1000));
  });
  const dateStrings = times.map((t) => {
    // finally; show in local timeZone again
    return processDate(t.tz(timeZone), language, timeZone, { selectedTimeFormat, withDefaultTimeFormat });
  });

  return [dateStrings, times.map((t) => t.toDate())];
};
