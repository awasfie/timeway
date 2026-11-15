import { getLocale } from "@calcom/features/auth/lib/getLocale";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { getBookingPageLocale } from "@lib/i18n/getBookingPageLocale";
import { PATHNAME_HEADER } from "@lib/i18n/pathnameHeader";
import { dir } from "i18next";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { frontLocaleFromPath } from "~/marketing/frontPaths";

/** Locale, direction and embed flags for one request; cached so the root layout and the app
 * providers (AppProvidersServer) resolve them once. */
export const getRequestLocale = cache(async () => {
  const h = await headers();
  const isEmbed = h.get("x-isEmbed") === "true";
  const embedColorScheme = h.get("x-embedColorScheme");
  // A booking page whose event type pins interfaceLanguage renders in that language for every visitor,
  // so <html lang/dir> must follow it in the SSR HTML, not the visitor's Accept-Language (TW-AWS-3).
  // FRONT-DOOR-timeway: /ar and /ar/pricing are Arabic whatever the visitor's Accept-Language says.
  const eventLocale =
    frontLocaleFromPath(h.get(PATHNAME_HEADER)) ?? (await getBookingPageLocale(h.get(PATHNAME_HEADER)));
  const locale = eventLocale ?? (await getLocale(buildLegacyRequest(h, await cookies()))) ?? "en";
  const direction = dir(locale) ?? "ltr";
  return { isEmbed, embedColorScheme, locale, direction };
});
