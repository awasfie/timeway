import Link from "next/link";
import { MarketingShell } from "./MarketingShell";
import { PricingCards } from "./PricingCards";
import { REGIONAL_FEATURES } from "./plans";

const pillars = [
  {
    title: "Share one link",
    body: "Publish your availability once. People pick a time that works and it lands on your calendar.",
  },
  {
    title: "Never double-book",
    body: "Two-way sync with Google and Outlook keeps every booking page current.",
  },
  {
    title: "Fewer no-shows",
    body: "Email and WhatsApp confirmations and reminders go out on their own.",
  },
];

const faq = [
  {
    q: "When am I charged?",
    a: "Pro starts with a 14-day free trial. Your card is charged on day 14 unless you cancel first.",
  },
  {
    q: "How do I cancel?",
    a: "Cancel any time from your billing settings. Monthly plans aren't refunded; yearly plans are refunded pro-rata within 30 days of the first purchase.",
  },
  {
    q: "Is there a free plan?",
    a: "Yes. One user, two event types and one calendar, free for as long as you like.",
  },
];

export function LandingPage({ appName }: { appName: string }) {
  return (
    <MarketingShell appName={appName}>
      <section className="mx-auto max-w-6xl px-6 py-16 md:py-24">
        <h1 className="max-w-3xl font-semibold text-4xl md:text-5xl">Find a time that works.</h1>
        <p className="mt-5 max-w-2xl text-brand-ink-muted text-lg">
          {appName} is online scheduling built for the Gulf: share your availability, let people choose a
          time, and get back to what matters. Plans from $7 per user a month.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/signup"
            className="rounded-brand-md bg-brand-primary px-5 py-3 font-semibold text-brand-surface-alt">
            Start free 14-day trial
          </Link>
          <Link
            href="/pricing"
            className="rounded-brand-md border border-brand-primary px-5 py-3 font-semibold text-brand-primary">
            See pricing
          </Link>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-6 px-6 pb-16 md:grid-cols-3">
        {pillars.map((p) => (
          <div key={p.title} className="rounded-brand-md bg-brand-surface-alt p-6">
            <h2 className="font-semibold text-lg">{p.title}</h2>
            <p className="mt-2 text-brand-ink-muted">{p.body}</p>
          </div>
        ))}
      </section>

      <section className="bg-brand-surface-alt">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <h2 className="font-semibold text-2xl">Made for how the region works</h2>
          <p className="mt-2 text-brand-ink-muted">Included free on every plan.</p>
          <ul className="mt-4 grid gap-2 md:grid-cols-2">
            {REGIONAL_FEATURES.map((f) => (
              <li key={f}>✓ {f}</li>
            ))}
          </ul>
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="mb-8 font-semibold text-2xl">Pricing</h2>
        <PricingCards />
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-16">
        <h2 className="font-semibold text-2xl">Questions</h2>
        {faq.map((f) => (
          <div key={f.q} className="mt-6">
            <h3 className="font-semibold">{f.q}</h3>
            <p className="mt-1 text-brand-ink-muted">{f.a}</p>
          </div>
        ))}
      </section>
    </MarketingShell>
  );
}
