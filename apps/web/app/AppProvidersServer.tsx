import { loadTranslations } from "@calcom/i18n/server";
import { headers } from "next/headers";
import authKeys from "./auth-i18n/authKeys.json";
import { getRequestLocale } from "./requestLocale";

/**
 * UX.13.3-3b: the session/tRPC/geo providers and the common.json translations (~86 KB gz in the RSC
 * payload) used to sit in the root layout, so the signed-out marketing pages (/, /pricing, /ar,
 * /privacy, /terms) paid for them. They now wrap only the routes that use them: the
 * (use-page-wrapper) and (booking-page-wrapper) groups, e2e/session-warmup and the lazy 404 body.
 * Callers are async server components: `<AppProviders {...await getAppProviderProps()}>`.
 */
export async function getAppProviderProps() {
  const h = await headers();
  const nonce = h.get("x-csp-nonce") ?? "";
  const country = h.get("cf-ipcountry") || h.get("x-vercel-ip-country") || "Unknown";
  const { locale, isEmbed } = await getRequestLocale();
  const ns = "common";
  const translations = await loadTranslations(locale, ns);
  return { nonce, country, locale, isEmbed, ns, translations };
}

/**
 * UX13.3-4: the signed-out auth pages (/auth/login, /signup) ship only the keys they render
 * (app/auth-i18n/authKeys.json, ~1.4 KB gz) instead of the whole common.json (~84 KB gz). The
 * locale-merged table is subset, so non-English locales keep their English fallbacks.
 * app/auth-i18n/authKeys.test.ts fails when the list no longer covers the pages' t("literal") keys.
 */
export async function getAuthAppProviderProps(): Promise<AppProviderProps> {
  const props = await getAppProviderProps();
  const translations: Record<string, string> = {};
  for (const key of authKeys as string[]) {
    const v = props.translations[key];
    if (v !== undefined) translations[key] = v;
  }
  return { ...props, translations };
}

export type AppProviderProps = Awaited<ReturnType<typeof getAppProviderProps>>;
