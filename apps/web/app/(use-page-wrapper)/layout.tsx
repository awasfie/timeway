import process from "node:process";
import { getLocale } from "@calcom/features/auth/lib/getLocale";
import { loadTranslations } from "@calcom/i18n/server";
import PageWrapper from "@components/PageWrapperAppDir";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { cookies, headers } from "next/headers";
import Script from "next/script";
import { AppRouterI18nProvider } from "../AppRouterI18nProvider";
import { AuthedAppProviders } from "../AuthedAppProviders";

export default async function PageWrapperLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const nonce = h.get("x-csp-nonce") ?? undefined;
  const isEmbed = h.get("x-isEmbed") === "true";
  const headScript = process.env.NEXT_PUBLIC_HEAD_SCRIPTS;
  const bodyScript = process.env.NEXT_PUBLIC_BODY_SCRIPTS;
  // The root layout passes only the booker subset (WC-TW-6c-9c-2b); app pages get the whole dictionary.
  const locale = (await getLocale(buildLegacyRequest(h, await cookies()))) ?? "en";
  const translations = await loadTranslations(locale, "common");

  const scripts = [
    {
      id: "injected-head-script",
      script: headScript ?? "",
    },
    {
      id: "injected-body-script",
      script: bodyScript ?? "",
    },
  ].filter((script): script is { id: string; script: string } => !!script.script);

  return (
    <AppRouterI18nProvider translations={translations} locale={locale} ns="common">
      <AuthedAppProviders isEmbed={isEmbed}>
        <PageWrapper requiresLicense={false} nonce={nonce}>
          {children}
          {scripts.map((script) => (
            // biome-ignore lint/security/noDangerouslySetInnerHtml: Injected scripts from env vars
            <Script
              key={script.id}
              nonce={nonce}
              id={script.id}
              dangerouslySetInnerHTML={{
                __html: script.script,
              }}
            />
          ))}
        </PageWrapper>
      </AuthedAppProviders>
    </AppRouterI18nProvider>
  );
}
