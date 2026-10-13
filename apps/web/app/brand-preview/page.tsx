// UX-T0 proof (UX-32): Timeway token preview — buttons, inputs, badges, type scale, EN and AR.
// Tokens only (UX.1.2 via packages/config/theme/brand-timeway.css); no hex literals (check-no-hex.mjs).
import { tokens } from "@calcom/ui/brand-tokens";

export const metadata = { title: "Timeway tokens", robots: { index: false } };

const copy = {
  en: {
    dir: "ltr",
    font: "font-brand",
    h: "Find a time that works.",
    p: "Share your availability, let people choose a time, and get back to what matters.",
    cta: "Create your booking page",
    confirm: "Confirm this time",
    sec: "See how it works",
    ph: "you@company.com",
  },
  ar: {
    dir: "rtl",
    font: "font-brand-ar",
    h: "اعثر على وقت يناسبك.",
    p: "شارك أوقات تفرّغك، ودع الآخرين يختارون موعدًا، وعُد إلى ما يهمّك.",
    cta: "أنشئ صفحة الحجز",
    confirm: "أكّد هذا الموعد",
    sec: "تعرّف على طريقة العمل",
    ph: "you@company.com",
  },
} as const;

function Block({ l }: { l: keyof typeof copy }) {
  const c = copy[l];
  return (
    <section dir={c.dir} lang={l} className={`${c.font} bg-brand-surface text-brand-ink p-8 space-y-6`}>
      <h1 className="text-4xl font-semibold">{c.h}</h1>
      <h2 className="text-2xl font-semibold">{c.h}</h2>
      <h3 className="text-lg font-medium">{c.h}</h3>
      <p className="text-base text-brand-ink-muted">{c.p}</p>
      <div className="flex flex-wrap gap-3">
        <button className="bg-brand-primary text-brand-surface-alt rounded-brand-md px-4 py-2 font-semibold">
          {c.cta}
        </button>
        <button className="bg-brand-seafoam text-brand-ink rounded-brand-md px-4 py-2 font-semibold">
          {c.confirm}
        </button>
        <button className="border border-brand-primary text-brand-primary rounded-brand-md px-4 py-2 font-semibold">
          {c.sec}
        </button>
      </div>
      <input
        dir="auto"
        placeholder={c.ph}
        className="bg-brand-surface-alt border border-brand-border rounded-brand-sm px-3 py-2 w-80"
      />
      <div className="flex flex-wrap gap-2">
        {/* Ink text on white with the semantic colour as border + dot: white text-sm on success (4.17:1) and warning (3.64:1) fails AA. */}
        {(
          [
            ["success", "border-brand-success", "bg-brand-success"],
            ["warning", "border-brand-warning", "bg-brand-warning"],
            ["danger", "border-brand-danger", "bg-brand-danger"],
            ["info", "border-brand-info", "bg-brand-info"],
          ] as const
        ).map(([k, border, dot]) => (
          <span
            key={k}
            className={`inline-flex items-center gap-1.5 rounded-brand-full border bg-brand-surface-alt px-3 py-1 text-sm font-medium text-brand-ink ${border}`}>
            <span aria-hidden className={`h-2 w-2 rounded-brand-full ${dot}`} />
            {k}
          </span>
        ))}
      </div>
    </section>
  );
}

export default function Page() {
  return (
    <main>
      <Block l="en" />
      <Block l="ar" />
      <ul className="font-brand p-8 text-sm text-brand-ink-muted">
        {Object.entries(tokens).map(([k, v]) => (
          <li key={k}>
            {k}: {v}
          </li>
        ))}
      </ul>
    </main>
  );
}
