import type { NumeralSystem } from "./countryPresets";

export function formatHijri(date: Date, opts: { locale?: string; timeZone?: string; numerals?: NumeralSystem } = {}): string {
  const { locale = "ar-SA", timeZone = "Asia/Riyadh", numerals = "arab" } = opts;
  return new Intl.DateTimeFormat(`${locale}-u-ca-islamic-umalqura-nu-${numerals}`, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone,
  }).format(date);
}

export function hijriParts(date: Date, timeZone = "Asia/Riyadh"): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", {
    day: "numeric", month: "numeric", year: "numeric", timeZone,
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}
