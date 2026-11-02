import type { Locale } from "../../../vendor/analytics/src/events";

/** The analytics vocabulary only knows ar/en; any other locale is reported as absent. */
export function toAnalyticsLocale(locale: string | null | undefined): Locale | null {
  const base = (locale ?? "").toLowerCase().split(/[-_]/)[0];
  return base === "ar" || base === "en" ? base : null;
}
