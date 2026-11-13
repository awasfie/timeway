import { headers } from "next/headers";
import Script from "next/script";

import PageWrapper from "@components/PageWrapperAppDir";

// UX13.3-4: /auth/login and /signup are signed-out pages. They render the same PageWrapper as
// (use-page-wrapper) but without AppShellProviders (web push + its service worker, nuqs, the coss
// toast manager, notification sounds, react-inlinesvg cache), which neither form uses and which
// put ~80 KB of route JS on their first load. URLs are unchanged: route groups do not add segments.
export default async function AuthPageWrapperLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const nonce = h.get("x-csp-nonce") ?? undefined;
  const headScript = process.env.NEXT_PUBLIC_HEAD_SCRIPTS;
  const bodyScript = process.env.NEXT_PUBLIC_BODY_SCRIPTS;

  const scripts = [
    { id: "injected-head-script", script: headScript ?? "" },
    { id: "injected-body-script", script: bodyScript ?? "" },
  ].filter((script): script is { id: string; script: string } => !!script.script);

  return (
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
  );
}
