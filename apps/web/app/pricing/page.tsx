import { APP_NAME, SUPPORT_MAIL_ADDRESS } from "@calcom/lib/constants";
import { _generateMetadataForStaticPage } from "app/_utils";
import type { Metadata } from "next";
import { MarketingShell } from "~/marketing/MarketingShell";
import { PricingCards } from "~/marketing/PricingCards";

// L8-6-TW (Bible v13 L.3 1b): public pricing, amounts from PART CM.3 via ~/marketing/plans.
export const dynamic = "force-static";

export const generateMetadata = async (): Promise<Metadata> =>
  await _generateMetadataForStaticPage(
    "Pricing",
    `${APP_NAME} plans: Free, Pro $7, Teams $11 and Business $19 per user a month. VAT included where applicable.`,
    undefined,
    undefined,
    "/pricing"
  );

export default function PricingPage() {
  return (
    <MarketingShell appName={APP_NAME}>
      <section className="mx-auto max-w-6xl px-6 py-16">
        <h1 className="font-semibold text-4xl">Pricing</h1>
        <p className="mt-3 mb-10 max-w-2xl text-brand-ink-muted text-lg">
          Start free. Upgrade when you need unlimited event types, team scheduling or your own domain.
        </p>
        <PricingCards />
        <p className="mt-10 text-sm">
          Questions about a plan or paying by invoice?{" "}
          <a href={`mailto:${SUPPORT_MAIL_ADDRESS}`} className="text-brand-primary underline">
            Contact us
          </a>
          .
        </p>
      </section>
    </MarketingShell>
  );
}
