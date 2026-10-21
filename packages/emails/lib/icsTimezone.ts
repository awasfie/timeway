// Builds DTSTART/DTEND with TZID and a matching VTIMEZONE from the runtime's tzdata (Intl),
// so no tz database dependency is added. Observances are emitted as explicit transitions
// over a bounded window around the event; RFC 5545 allows observances without RRULE.

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const getFormatter = (timeZone: string) => {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
};

export const isValidTimeZone = (timeZone: string | undefined | null): timeZone is string => {
  if (!timeZone) return false;
  try {
    getFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
};

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

const getLocalParts = (timeZone: string, epochMs: number): LocalParts => {
  const parts: Record<string, number> = {};
  for (const part of getFormatter(timeZone).formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  const { year, month, day, hour, minute, second } = parts;
  return { year, month, day, hour, minute, second };
};

/** Offset from UTC in minutes at the given instant. */
const getOffsetMinutes = (timeZone: string, epochMs: number) => {
  const p = getLocalParts(timeZone, epochMs);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(epochMs / 1000) * 1000) / MINUTE_MS);
};

const pad = (n: number, width = 2) => String(n).padStart(width, "0");

const formatLocal = (p: LocalParts) =>
  `${pad(p.year, 4)}${pad(p.month)}${pad(p.day)}T${pad(p.hour)}${pad(p.minute)}${pad(p.second)}`;

/** Local wall-clock time as an iCalendar DATE-TIME without the Z suffix. */
export const toLocalIcsDateTime = (timeZone: string, iso: string) =>
  formatLocal(getLocalParts(timeZone, new Date(iso).getTime()));

const formatOffset = (minutes: number) => {
  const sign = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${sign}${pad(Math.floor(abs / 60))}${pad(abs % 60)}`;
};

/** Standard offset of a year = the smaller of the January and July offsets (works for both hemispheres). */
const getStandardOffset = (timeZone: string, year: number) =>
  Math.min(
    getOffsetMinutes(timeZone, Date.UTC(year, 0, 1)),
    getOffsetMinutes(timeZone, Date.UTC(year, 6, 1))
  );

type Transition = { at: number; from: number; to: number };

const findTransitions = (timeZone: string, startMs: number, endMs: number): Transition[] => {
  const transitions: Transition[] = [];
  let prevMs = startMs;
  let prevOffset = getOffsetMinutes(timeZone, prevMs);
  for (let t = startMs + DAY_MS; t <= endMs; t += DAY_MS) {
    const offset = getOffsetMinutes(timeZone, t);
    if (offset !== prevOffset) {
      let lo = prevMs;
      let hi = t;
      while (hi - lo > MINUTE_MS) {
        const mid = lo + Math.floor((hi - lo) / 2 / MINUTE_MS) * MINUTE_MS;
        if (getOffsetMinutes(timeZone, mid) === prevOffset) lo = mid;
        else hi = mid;
      }
      transitions.push({ at: hi, from: prevOffset, to: offset });
      prevOffset = offset;
    }
    prevMs = t;
  }
  return transitions;
};

const observance = (timeZone: string, dtstart: string, from: number, to: number, year: number) => {
  const kind = to > getStandardOffset(timeZone, year) ? "DAYLIGHT" : "STANDARD";
  return [
    `BEGIN:${kind}`,
    `DTSTART:${dtstart}`,
    `TZOFFSETFROM:${formatOffset(from)}`,
    `TZOFFSETTO:${formatOffset(to)}`,
    `END:${kind}`,
  ];
};

/**
 * VTIMEZONE lines for `timeZone` from Jan 1 of the year before `startIso` to Jan 1 two years after `endIso`.
 * Transition DTSTARTs are expressed in the pre-transition local time, as RFC 5545 3.6.5 requires.
 */
export const buildVTimezone = (timeZone: string, startIso: string, endIso: string): string[] => {
  const startYear = new Date(startIso).getUTCFullYear() - 1;
  const endYear = new Date(endIso).getUTCFullYear() + 2;
  const windowStart = Date.UTC(startYear, 0, 1);
  const windowEnd = Date.UTC(endYear, 0, 1);
  const initialOffset = getOffsetMinutes(timeZone, windowStart);
  const lines = [
    "BEGIN:VTIMEZONE",
    `TZID:${timeZone}`,
    ...observance(timeZone, "19700101T000000", initialOffset, initialOffset, startYear),
  ];
  for (const { at, from, to } of findTransitions(timeZone, windowStart, windowEnd)) {
    const local = formatLocal(getLocalParts("UTC", at + from * MINUTE_MS));
    lines.push(...observance(timeZone, local, from, to, new Date(at).getUTCFullYear()));
  }
  lines.push("END:VTIMEZONE");
  return lines;
};
