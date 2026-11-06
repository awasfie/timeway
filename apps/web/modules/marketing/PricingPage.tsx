import { SUPPORT_MAIL_ADDRESS } from "@calcom/lib/constants";
import { type FrontLocale, ft } from "./i18n";
import { MarketingShell } from "./MarketingShell";
import { PricingCards } from "./PricingCards";

// L8-6-TW (Bible v13 L.3 1b) / FRONT-DOOR-timeway: public pricing, amounts from passport price-map.md.
export function MarketingPricingPage({ appName, locale = "en" }: { appName: string; locale?: FrontLocale }) {
  const l = locale;
  return (
    <MarketingShell appName={appName} locale={l} path="/pricing">
      <section className="mx-auto max-w-6xl px-6 py-16">
        <h1 className="font-semibold text-4xl">{ft(l, "pricingTitle")}</h1>
        <p className="mt-3 mb-10 max-w-2xl text-brand-ink-muted text-lg">{ft(l, "pricingLead")}</p>
        <PricingCards locale={l} />
        <p className="mt-10 text-sm">
          {ft(l, "contactLead")}{" "}
          <a href={`mailto:${SUPPORT_MAIL_ADDRESS}`} className="text-brand-primary underline">
            {ft(l, "contactUs")}
          </a>
          .
        </p>
      </section>
    </MarketingShell>
  );
}
