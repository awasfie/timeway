import Link from "next/link";
import type { FrontLocale } from "./i18n";
import { ft } from "./i18n";
import { marketingPlans, taxNotice, trialNotice } from "./plans";

// L8-6-TW / FRONT-DOOR-timeway: CM.3 tier cards from price-map.md, yearly beside monthly, EN or AR.
export function PricingCards({ locale = "en" }: { locale?: FrontLocale }) {
  const l = locale;
  return (
    <div>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {marketingPlans(l).map((plan) => (
          <section
            key={plan.id}
            className={`flex flex-col rounded-brand-md border bg-brand-surface-alt p-6 ${
              plan.id === "pro" ? "border-brand-primary" : "border-brand-border"
            }`}>
            <h3 className="font-semibold text-lg">{plan.name}</h3>
            <p className="mt-3">
              <span className="font-semibold text-3xl text-brand-primary" dir="ltr">
                {plan.monthly}
              </span>
              <span className="text-brand-ink-muted text-sm">
                {" "}
                /{plan.id === "free" ? ft(l, "perMonthFree") : ft(l, "perUserMonth")}
              </span>
            </p>
            <p className="mt-1 text-brand-ink-muted text-sm">
              {plan.yearly ? ft(l, "orYearly", { amount: plan.yearly }) : plan.unit}
            </p>
            <ul className="mt-4 flex-1 space-y-2 text-sm">
              {plan.highlights.map((h) => (
                <li key={h}>✓ {h}</li>
              ))}
            </ul>
            <Link
              href="/signup"
              className={`mt-6 rounded-brand-md px-4 py-2 text-center font-semibold text-sm ${
                plan.id === "pro"
                  ? "bg-brand-primary text-brand-surface-alt"
                  : "border border-brand-primary text-brand-primary"
              }`}>
              {plan.cta}
            </Link>
            <p className="mt-2 text-center text-brand-ink-muted text-xs">{plan.trial}</p>
          </section>
        ))}
      </div>
      <p className="mt-6 text-brand-ink-muted text-sm">{trialNotice(l)}</p>
      <p className="mt-1 text-brand-ink-muted text-sm">{taxNotice(l)}</p>
    </div>
  );
}
