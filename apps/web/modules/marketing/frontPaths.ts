import type { FrontLocale } from "./i18n";

/** Arabic front-door paths. The proxy matches exactly these and sets PATHNAME_HEADER to the original path
 * (next.config's beforeFiles rewrite then strips the /ar prefix, so / and /pricing render both locales). */
export const AR_FRONT_PATHS = ["/ar", "/ar/", "/ar/pricing", "/ar/pricing/"] as const;

export const frontLocaleFromPath = (pathname: string | null | undefined): FrontLocale | null =>
  pathname && (AR_FRONT_PATHS as readonly string[]).includes(pathname) ? "ar" : null;
