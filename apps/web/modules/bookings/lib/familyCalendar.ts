import type { CalendarSystemProps } from "@family/ui";
import { useCallback, useEffect, useState } from "react";

export const HIJRI_TOGGLE_STORAGE_KEY = "timeway.booker.showHijri";

const WEEKDAY_IDS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type WeekdayId = (typeof WEEKDAY_IDS)[number];

export const weekIndexToWeekdayId = (index: number): WeekdayId => WEEKDAY_IDS[((index % 7) + 7) % 7];

/** Only SA is decided here (WC-DX-7d); the per-country policy belongs to WC-DX-8. */
export const isHijriDefaultCountry = (countryCode?: string | null): boolean =>
  countryCode?.toUpperCase() === "SA";

/**
 * Slots are keyed by Gregorian dates, so the primary calendar stays gregory even for `ar` locales
 * whose Intl default is a Hijri calendar; Hijri is shown as the secondary day number.
 */
export const resolveBookerCalendarProps = (showHijri: boolean): CalendarSystemProps => ({
  calendar: "gregory",
  ...(showHijri ? { secondaryCalendar: "islamic-umalqura", highlightRamadan: true } : {}),
});

// Storage can be missing or throw (SSR, Safari private mode, sandboxed embeds); the toggle then lives in state only.
const storage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : (window.localStorage ?? null);
  } catch {
    return null;
  }
};

const readStoredToggle = (): boolean | null => {
  const value = storage()?.getItem(HIJRI_TOGGLE_STORAGE_KEY) ?? null;
  return value === null ? null : value === "true";
};

/** The org-country default applies until the booker flips the toggle; their choice then persists. */
export const useHijriToggle = (ownerCountryCode?: string | null) => {
  const countryDefault = isHijriDefaultCountry(ownerCountryCode);
  const [showHijri, setShowHijri] = useState<boolean>(countryDefault);

  useEffect(() => {
    setShowHijri(readStoredToggle() ?? countryDefault);
  }, [countryDefault]);

  const toggle = useCallback((next: boolean) => {
    setShowHijri(next);
    try {
      storage()?.setItem(HIJRI_TOGGLE_STORAGE_KEY, String(next));
    } catch {
      /* quota or privacy mode: keep the in-memory choice */
    }
  }, []);

  return { showHijri, setShowHijri: toggle };
};
