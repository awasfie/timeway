import { headers } from "next/headers";
import Script from "next/script";

import PageWrapper from "@components/PageWrapperAppDir";

import { AuthedAppProviders } from "../AuthedAppProviders";

export default async function PageWrapperLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const nonce = h.get("x-csp-nonce") ?? undefined;
  const isEmbed = h.get("x-isEmbed") === "true";
  const headScript = process.env.NEXT_PUBLIC_HEAD_SCRIPTS;
  const bodyScript = process.env.NEXT_PUBLIC_BODY_SCRIPTS;

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
  );
}
