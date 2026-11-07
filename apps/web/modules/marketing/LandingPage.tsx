import Link from "next/link";
import { LAUNCH } from "./front-door.generated";
import { FAQ_COPY, type FrontLocale, frontPath, ft } from "./i18n";
import { MarketingShell } from "./MarketingShell";
import { PricingCards } from "./PricingCards";
import { FROM_PRICE, regionalFeatures, TRIAL_DAYS } from "./plans";

// FRONT-DOOR-timeway (t_52034498): hero and feature copy from docs/launch/timeway.yaml (via the generator),
// amounts from passport price-map.md. EN at /, AR at /ar.
export function LandingPage({ appName, locale = "en" }: { appName: string; locale?: FrontLocale }) {
  const l = locale;
  const days = { days: TRIAL_DAYS };
  return (
    <MarketingShell appName={appName} locale={l} path="/">
      <section className="mx-auto max-w-6xl px-6 py-16 md:py-24">
        <h1 className="max-w-3xl font-semibold text-4xl md:text-5xl">{LAUNCH.hero.title[l]}</h1>
        <p className="mt-5 max-w-2xl text-brand-ink-muted text-lg">
          {LAUNCH.hero.sub[l]} {ft(l, "fromPrice", { amount: FROM_PRICE })}
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/signup"
            className="rounded-brand-md bg-brand-primary px-5 py-3 font-semibold text-brand-surface-alt">
            {LAUNCH.hero.cta[l]}
          </Link>
          <Link
            href={frontPath(l, "/pricing")}
            className="rounded-brand-md border border-brand-primary px-5 py-3 font-semibold text-brand-primary">
            {ft(l, "seePricing")}
          </Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-6 pb-16 md:grid-cols-3">
        {LAUNCH.features.map((p) => (
          <div key={p.title.en} className="rounded-brand-md bg-brand-surface-alt p-6">
            <h2 className="font-semibold text-lg">{p.title[l]}</h2>
            <p className="mt-2 text-brand-ink-muted">{p.body[l]}</p>
          </div>
        ))}
      </section>

      <section className="bg-brand-surface-alt">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <h2 className="font-semibold text-2xl">{ft(l, "regionalTitle")}</h2>
          <p className="mt-2 text-brand-ink-muted">{ft(l, "regionalLead")}</p>
          <ul className="mt-4 grid gap-2 md:grid-cols-2">
            {regionalFeatures(l).map((f) => (
              <li key={f}>✓ {f}</li>
            ))}
          </ul>
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="mb-8 font-semibold text-2xl">{ft(l, "pricingTitle")}</h2>
        <PricingCards locale={l} />
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-16">
        <h2 className="font-semibold text-2xl">{ft(l, "questions")}</h2>
        {FAQ_COPY.map((f) => (
          <div key={f.q.en} className="mt-6">
            <h3 className="font-semibold">{f.q[l]}</h3>
            <p className="mt-1 text-brand-ink-muted">{f.a[l].replace(/\{days\}/g, String(days.days))}</p>
          </div>
        ))}
      </section>
    </MarketingShell>
  );
}
