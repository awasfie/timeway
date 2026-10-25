import type { Madhab, PrayerMethodId, Coordinates, PrayerOffsets } from "./prayerTimes";

export type CountryCode = "EG" | "SA" | "AE";
export type NumeralSystem = "latn" | "arab";
export type WeekDay = 0 | 1 | 2 | 3 | 4 | 5 | 6; // 0 = Sunday

export type CountryPreset = {
  country: CountryCode;
  weekendDays: WeekDay[];
  weekStart: WeekDay;
  numerals: NumeralSystem;
  prayerMethod: PrayerMethodId;
  asrMadhab: Madhab;
  secondaryCalendar: "islamic-umalqura" | null;
  timeZone: string;
};

export const COUNTRY_PRESETS: Record<CountryCode, CountryPreset> = {
  EG: { country: "EG", weekendDays: [5, 6], weekStart: 6, numerals: "latn", prayerMethod: "egyptian", asrMadhab: "standard", secondaryCalendar: null, timeZone: "Africa/Cairo" },
  SA: { country: "SA", weekendDays: [5, 6], weekStart: 0, numerals: "arab", prayerMethod: "ummAlQura", asrMadhab: "standard", secondaryCalendar: "islamic-umalqura", timeZone: "Asia/Riyadh" },
  AE: { country: "AE", weekendDays: [6, 0], weekStart: 1, numerals: "latn", prayerMethod: "dubai", asrMadhab: "standard", secondaryCalendar: null, timeZone: "Asia/Dubai" },
};

export type City = { id: string; country: CountryCode; coordinates: Coordinates; offsets: PrayerOffsets };

// Per-city minute offsets (local-authority timetables); empty until a verified timetable is entered.
export const CITY_TABLE: City[] = [
  { id: "cairo", country: "EG", coordinates: { latitude: 30.0444, longitude: 31.2357 }, offsets: {} },
  { id: "riyadh", country: "SA", coordinates: { latitude: 24.7136, longitude: 46.6753 }, offsets: {} },
  { id: "dubai", country: "AE", coordinates: { latitude: 25.2048, longitude: 55.2708 }, offsets: {} },
];

export function getPreset(country: string): CountryPreset | null {
  return COUNTRY_PRESETS[country.toUpperCase() as CountryCode] ?? null;
}

/** Week order derived from the org's week start; Monday is never assumed first. */
export function orderedWeekdays(weekStart: WeekDay): WeekDay[] {
  return Array.from({ length: 7 }, (_, i) => ((weekStart + i) % 7) as WeekDay);
}

export function isWeekend(preset: Pick<CountryPreset, "weekendDays">, day: WeekDay): boolean {
  return preset.weekendDays.includes(day);
}

const ARABIC_INDIC = "٠١٢٣٤٥٦٧٨٩";
export function formatNumerals(value: string | number, system: NumeralSystem): string {
  const s = String(value);
  return system === "arab" ? s.replace(/\d/g, (d) => ARABIC_INDIC[Number(d)]) : s;
}
