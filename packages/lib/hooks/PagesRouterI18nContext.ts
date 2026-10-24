import type { i18n, TFunction } from "i18next";
import { createContext } from "react";

export type LocaleContextValue = {
  i18n: i18n;
  t: TFunction;
  isLocaleReady: boolean;
};

// Filled by the pages-router provider (apps/web/lib/app-providers.tsx) from react-i18next, so useLocale does not
// import react-i18next and app-router pages (the booking route) ship without it.
export const PagesRouterI18nContext = createContext<LocaleContextValue | null>(null);
