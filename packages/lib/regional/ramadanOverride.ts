import { hijriParts } from "./hijri";

export type RamadanOverride = {
  hijriYear: number;
  startsOn: string; // YYYY-MM-DD
  endsOn: string;
  // Admin must confirm; an unconfirmed suggestion never changes hours.
  confirmedAt: string | null;
  workingHours: { start: string; end: string };
};

const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Pre-fills a suggested override from the umalqura calendar; confirmedAt stays null. */
export function suggestRamadanOverride(
  from: Date,
  workingHours = { start: "10:00", end: "15:00" },
  timeZone = "Asia/Riyadh",
): RamadanOverride | null {
  for (let i = 0; i < 400; i++) {
    const d = new Date(from.getTime() + i * DAY);
    const h = hijriParts(d, timeZone);
    if (h.month === 9 && h.day === 1) {
      let end = d;
      while (hijriParts(new Date(end.getTime() + DAY), timeZone).month === 9) end = new Date(end.getTime() + DAY);
      return { hijriYear: h.year, startsOn: iso(d), endsOn: iso(end), confirmedAt: null, workingHours };
    }
  }
  return null;
}

export function confirmRamadanOverride(o: RamadanOverride, now: Date): RamadanOverride {
  return { ...o, confirmedAt: now.toISOString() };
}

/** Active only when admin-confirmed and inside its window; expires automatically after endsOn. */
export function isRamadanOverrideActive(o: RamadanOverride | null, onDate: Date): boolean {
  if (!o?.confirmedAt) return false;
  const day = iso(onDate);
  return day >= o.startsOn && day <= o.endsOn;
}
