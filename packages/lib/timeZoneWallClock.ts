// Offsets and wall clocks are read from Intl directly: dayjs's tz() round-trips through
// `new Date(localeString)`, which parses in the process TZ and is wrong near that TZ's own transitions.
const wallClockFormatters = new Map<string, Intl.DateTimeFormat>();
function getWallClockFormatter(timeZone: string) {
  let formatter = wallClockFormatters.get(timeZone);
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
    wallClockFormatters.set(timeZone, formatter);
  }
  return formatter;
}

export function wallClockParts(ms: number, timeZone: string) {
  const parts: Record<string, number> = {};
  for (const part of getWallClockFormatter(timeZone).formatToParts(new Date(ms))) {
    if (part.type !== "literal") parts[part.type] = Number(part.value);
  }
  return parts as Record<"year" | "month" | "day" | "hour" | "minute" | "second", number>;
}

export function offsetMinutesAt(ms: number, timeZone: string) {
  const p = wallClockParts(ms, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60000);
}

/**
 * UTC instant of a wall-clock time. In a repeated hour, "earlier"/"later" picks the occurrence;
 * a time inside a gap moves forward by the gap length (RFC 5545 / Temporal "compatible").
 */
export function wallClockToInstant(
  { year, month, day }: { year: number; month: number; day: number },
  minutesOfDay: number,
  timeZone: string,
  disambiguation: "earlier" | "later"
): number {
  const asUtc = Date.UTC(year, month - 1, day) + minutesOfDay * 60000;
  const offsetBefore = offsetMinutesAt(asUtc - 86400000, timeZone);
  const offsetAfter = offsetMinutesAt(asUtc + 86400000, timeZone);
  const candidates = [asUtc - offsetBefore * 60000, asUtc - offsetAfter * 60000].filter(
    (t) => asUtc - offsetMinutesAt(t, timeZone) * 60000 === t
  );
  if (!candidates.length) return asUtc - offsetBefore * 60000;
  return disambiguation === "earlier" ? Math.min(...candidates) : Math.max(...candidates);
}
