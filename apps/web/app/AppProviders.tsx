import type React from "react";
import { AppRouterI18nProvider } from "./AppRouterI18nProvider";
import { Providers } from "./providers";

/** Server-free half of AppProvidersServer, so the lazily loaded 404 body can mount it on the client. */
export type AppProvidersValue = {
  nonce: string;
  country: string;
  locale: string;
  isEmbed: boolean;
  ns: string;
  translations: Record<string, string>;
};

export function AppProviders({
  children,
  nonce,
  country,
  locale,
  isEmbed,
  ns,
  translations,
}: AppProvidersValue & { children: React.ReactNode }) {
  return (
    <Providers isEmbed={isEmbed} nonce={nonce} country={country}>
      <AppRouterI18nProvider translations={translations} locale={locale} ns={ns}>
        {children}
      </AppRouterI18nProvider>
    </Providers>
  );
}
