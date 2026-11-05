import type { PrayerName, PrayerTimes } from "./prayerTimes";

export type PrayerBufferConfig = {
  enabled: boolean; // default off per host
  minutesBefore: number;
  minutesAfter: number;
  prayers: PrayerName[];
};

export const DEFAULT_PRAYER_BUFFER: PrayerBufferConfig = {
  enabled: false,
  minutesBefore: 0,
  minutesAfter: 20,
  prayers: ["dhuhr", "asr", "maghrib"],
};

export function prayerBusyIntervals(times: PrayerTimes, cfg: PrayerBufferConfig = DEFAULT_PRAYER_BUFFER) {
  if (!cfg.enabled) return [];
  return cfg.prayers.map((p) => ({
    prayer: p,
    start: new Date(times[p].getTime() - cfg.minutesBefore * 60_000),
    end: new Date(times[p].getTime() + cfg.minutesAfter * 60_000),
  }));
}
