import { describe, expect, it } from "vitest";
import { COUNTRY_PRESETS, CITY_TABLE, formatNumerals, orderedWeekdays } from "./countryPresets";
import { formatHijri } from "./hijri";
import { computePrayerTimes } from "./prayerTimes";
import { DEFAULT_PRAYER_BUFFER, prayerBusyIntervals } from "./prayerBuffers";
import { confirmRamadanOverride, isRamadanOverrideActive, suggestRamadanOverride } from "./ramadanOverride";

const hm = (d: Date, tz: string) =>
  new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: tz, hour12: false }).format(d);

describe("regional engine", () => {
  it.each(CITY_TABLE)("computes ordered prayers for $id", (c) => {
    const p = COUNTRY_PRESETS[c.country];
    const t = computePrayerTimes({ date: { year: 2026, month: 10, day: 25 }, coordinates: c.coordinates, method: p.prayerMethod });
    const order = [t.fajr, t.sunrise, t.dhuhr, t.asr, t.maghrib, t.isha].map((d) => d.getTime());
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(hm(t.dhuhr, p.timeZone) >= "11:00" && hm(t.dhuhr, p.timeZone) <= "13:00").toBe(true);
  });

  it("Hanafi Asr is later than standard", () => {
    const base = { date: { year: 2026, month: 10, day: 25 }, coordinates: CITY_TABLE[0].coordinates, method: "egyptian" as const };
    expect(computePrayerTimes({ ...base, madhab: "hanafi" }).asr.getTime()).toBeGreaterThan(computePrayerTimes(base).asr.getTime());
  });

  it("applies per-city offsets", () => {
    const base = { date: { year: 2026, month: 10, day: 25 }, coordinates: CITY_TABLE[1].coordinates, method: "ummAlQura" as const };
    const a = computePrayerTimes(base).fajr.getTime();
    expect(computePrayerTimes({ ...base, offsets: { fajr: 2 } }).fajr.getTime() - a).toBe(120_000);
  });

  it("buffers are off by default", () => {
    const t = computePrayerTimes({ date: { year: 2026, month: 10, day: 25 }, coordinates: CITY_TABLE[2].coordinates, method: "dubai" });
    expect(prayerBusyIntervals(t)).toEqual([]);
    expect(prayerBusyIntervals(t, { ...DEFAULT_PRAYER_BUFFER, enabled: true })).toHaveLength(3);
  });

  it("umalqura dating renders in Arabic numerals", () => {
    const s = formatHijri(new Date(Date.UTC(2026, 8, 4, 12)));
    expect(s).toMatch(/[٠-٩]{4}/);
    expect(s).toMatch(/ربيع الأول/);
  });

  it("Ramadan override is unconfirmed until admin confirms, then auto-expires", () => {
    const o = suggestRamadanOverride(new Date(Date.UTC(2027, 0, 1)))!;
    expect(o.startsOn).toBe("2027-02-08");
    expect(isRamadanOverrideActive(o, new Date(`${o.startsOn}T12:00:00Z`))).toBe(false);
    const c = confirmRamadanOverride(o, new Date());
    expect(isRamadanOverrideActive(c, new Date(`${o.startsOn}T12:00:00Z`))).toBe(true);
    expect(isRamadanOverrideActive(c, new Date(Date.parse(`${o.endsOn}T12:00:00Z`) + 86_400_000))).toBe(false);
  });

  it("week start comes from the preset, never Monday by default", () => {
    expect(orderedWeekdays(COUNTRY_PRESETS.EG.weekStart)[0]).toBe(6);
    expect(orderedWeekdays(COUNTRY_PRESETS.SA.weekStart)[0]).toBe(0);
    expect(formatNumerals(1448, "arab")).toBe("١٤٤٨");
  });
});
