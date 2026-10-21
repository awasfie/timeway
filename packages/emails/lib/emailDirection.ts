import type { TFunction } from "i18next";

const RTL_LANGUAGES = new Set(["ar", "he", "iw", "fa", "ur"]);

export type EmailDirection = "rtl" | "ltr";

export function getEmailDirection(locale?: string | null): EmailDirection {
  const lang = (locale || "en").toLowerCase().split(/[-_]/)[0];
  return RTL_LANGUAGES.has(lang) ? "rtl" : "ltr";
}

/** Templates that only receive a TFunction (auth emails) recover the recipient locale from i18next's getFixedT. */
export function getLocaleFromT(t?: TFunction): string | undefined {
  const lng = (t as unknown as { lng?: unknown } | undefined)?.lng;
  return typeof lng === "string" ? lng : undefined;
}
