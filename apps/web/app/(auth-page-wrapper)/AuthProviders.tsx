import type React from "react";

import { AppRouterI18nProvider } from "../AppRouterI18nProvider";
import type { AppProvidersValue } from "../AppProviders";

/**
 * UX13.3-4 (t_823c75d4): /auth/login and /signup render signed out and use neither the session, tRPC nor
 * geo, so they skip Providers (SessionProvider, TrpcProvider, react-query, AnalyticsIdentify) and keep
 * only the i18n context the forms read through useLocale.
 */
export function AuthProviders({
  children,
  locale,
  ns,
  translations,
}: Pick<AppProvidersValue, "locale" | "ns" | "translations"> & { children: React.ReactNode }) {
  return (
    <AppRouterI18nProvider translations={translations} locale={locale} ns={ns}>
      {children}
    </AppRouterI18nProvider>
  );
}
