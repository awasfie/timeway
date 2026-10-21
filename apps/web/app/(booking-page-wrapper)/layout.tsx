import { headers } from "next/headers";
import Script from "next/script";

import { PLAUSIBLE_EVENT_PATH, PLAUSIBLE_SCRIPT_PATH } from "../../plausibleRewrites";

import PageWrapper from "@components/PageWrapperAppDir";

export default async function BookingPageWrapperLayout({ children }: { children: React.ReactNode }) {
  const h = await headers();
  const nonce = h.get("x-csp-nonce") ?? undefined;

  // First-party Plausible (WC-TW-9c): only on public booking pages, only when configured.
  const plausibleDomain = process.env.PLAUSIBLE_DOMAIN?.trim();
  const plausibleEnabled = !!plausibleDomain && !!process.env.PLAUSIBLE_HOST?.trim();

  return (
    <>
      {plausibleEnabled && (
        <Script
          src={PLAUSIBLE_SCRIPT_PATH}
          strategy="afterInteractive"
          defer
          nonce={nonce}
          data-domain={plausibleDomain}
          data-api={PLAUSIBLE_EVENT_PATH}
        />
      )}
      <PageWrapper isBookingPage={true} requiresLicense={false} nonce={nonce}>
        {children}
      </PageWrapper>
    </>
  );
}
