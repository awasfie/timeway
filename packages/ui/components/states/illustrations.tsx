// Ported 1:1 from awasfie/salesos packages/ui/src/states/illustrations.tsx @ 722e786ea5 (WC-DX-14a 3a68820 #236 + 14a2 d720520 #250)
// for WC-DX-14c2. Timeway token roles (packages/config/theme/tokens.css + brand-timeway.css) replace the @salesos/ui roles.
// currentColor + token vars only (no hex, UX.0.10), decorative (aria-hidden). Only first-use is directional
// (forward arrow) and mirrors in RTL.
const base = {
  width: 96,
  height: 96,
  viewBox: "0 0 96 96",
  fill: "none",
  "aria-hidden": true,
  focusable: false,
} as const;

export function FirstUseIllustration({ className }: { className?: string }) {
  return (
    <svg
      {...base}
      className={["rtl:-scale-x-100", className].filter(Boolean).join(" ")}
      data-illustration="first-use">
      <rect
        x="14"
        y="20"
        width="56"
        height="60"
        rx="8"
        fill="var(--cal-bg-subtle)"
        stroke="var(--cal-border)"
        strokeWidth="2"
      />
      <rect x="24" y="34" width="28" height="4" rx="2" fill="var(--cal-border)" />
      <rect x="24" y="46" width="36" height="4" rx="2" fill="var(--cal-border)" />
      <rect x="24" y="58" width="20" height="4" rx="2" fill="var(--cal-border)" />
      <circle cx="72" cy="66" r="14" fill="var(--color-brand-seafoam)" />
      <path
        d="M66 66h12m-5-5 5 5-5 5"
        stroke="var(--cal-bg)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function NoResultsIllustration({ className }: { className?: string }) {
  return (
    <svg {...base} className={className} data-illustration="no-results">
      <circle cx="42" cy="42" r="22" fill="var(--cal-bg-subtle)" stroke="currentColor" strokeWidth="3" />
      <path d="M58 58l18 18" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
      <path d="M34 42h16" stroke="var(--color-brand-seafoam)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function ClearedIllustration({ className }: { className?: string }) {
  return (
    <svg {...base} className={className} data-illustration="cleared">
      <circle
        cx="48"
        cy="48"
        r="32"
        fill="var(--cal-bg-subtle)"
        stroke="var(--cal-text-success)"
        strokeWidth="3"
      />
      <path
        d="M34 49l10 10 19-21"
        stroke="var(--cal-text-success)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="80" cy="20" r="4" fill="var(--color-brand-seafoam)" />
      <circle cx="16" cy="74" r="3" fill="currentColor" />
    </svg>
  );
}
