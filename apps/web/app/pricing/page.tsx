import { APP_NAME } from "@calcom/lib/constants";
import { _generateMetadataForStaticPage } from "app/_utils";
import type { Metadata } from "next";
import { getFrontLocale } from "~/marketing/frontLocale";
import { MarketingPricingPage } from "~/marketing/PricingPage";
import { MARKETING_PLANS } from "~/marketing/plans";

// L8-6-TW (Bible v13 L.3 1b) / FRONT-DOOR-timeway: public pricing, amounts from passport price-map.md
// (PART CM) via ~/marketing/front-door.generated. EN at /pricing, AR at /ar/pricing (same route, see proxy).
export const generateMetadata = async (): Promise<Metadata> =>
  await _generateMetadataForStaticPage(
    "Pricing",
    `${APP_NAME} plans: ${MARKETING_PLANS.map((p) => `${p.name} ${p.monthly}`).join(", ")} per user a month. VAT included where applicable.`,
    undefined,
    undefined,
    "/pricing"
  );

export default async function PricingPage() {
  return <MarketingPricingPage appName={APP_NAME} locale={await getFrontLocale()} />;
}
