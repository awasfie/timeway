import { headers } from "next/headers";
import Script from "next/script";

import PageWrapper from "@components/PageWrapperAppDir";

import { AppShellProviders } from "./AppShellProviders";

export default async function PageWrapperLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const nonce = h.get("x-csp-nonce") ?? undefined;
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
    <>
      <PageWrapper requiresLicense={false} nonce={nonce}>
        <AppShellProviders isEmbed={h.get("x-isEmbed") === "true"}>{children}</AppShellProviders>
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
    </>
  );
}
