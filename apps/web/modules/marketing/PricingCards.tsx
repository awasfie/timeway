import Link from "next/link";
import { MARKETING_PLANS, TAX_NOTICE, TRIAL_NOTICE } from "./plans";

// L8-6-TW: CM.3 tier cards, yearly shown beside monthly (CM.1 pricing preview).
export function PricingCards() {
  return (
    <div>
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {MARKETING_PLANS.map((plan) => (
          <section
            key={plan.id}
            className={`flex flex-col rounded-brand-md border bg-brand-surface-alt p-6 ${
              plan.id === "pro" ? "border-brand-primary" : "border-brand-border"
            }`}>
            <h3 className="font-semibold text-lg">{plan.name}</h3>
            <p className="mt-3">
              <span className="font-semibold text-3xl text-brand-primary">{plan.monthly}</span>
              <span className="text-brand-ink-muted text-sm">
                {" "}
                /{plan.id === "free" ? "month" : "user/month"}
              </span>
            </p>
            <p className="mt-1 text-brand-ink-muted text-sm">
              {plan.yearly ? `or ${plan.yearly} per user/year` : plan.unit}
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
      <p className="mt-6 text-brand-ink-muted text-sm">{TRIAL_NOTICE}</p>
      <p className="mt-1 text-brand-ink-muted text-sm">{TAX_NOTICE}</p>
    </div>
  );
}
