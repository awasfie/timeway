import Link from "next/link";
import type { ReactNode } from "react";
import { LEGAL_ENTITY } from "~/legal/content";
import { type FrontLocale, frontPath, ft } from "./i18n";

// L8-6-TW: server-rendered shell for the signed-out front door (no client JS, no session needed).
// FRONT-DOOR-timeway: EN at /, /pricing; AR at /ar, /ar/pricing (the root layout sets lang/dir from the path).

// PERF-timeway-UX13.3-3: the DM Sans swap reflowed <main> (Lighthouse layout-shifts: CLS 0.17, cause
// "Web font loaded" DMSans-Regular.woff2). Until DM Sans lands, Latin text renders in a local Arial-metric
// face sized to DM Sans' width over this page's copy (size-adjust) with DM Sans' vertical metrics, so the
// swap no longer rewraps lines; Arabic keeps the system face it had. Liberation Sans / Arimo stand in for
// Arial on Linux. No preload: the woff2s would join the LCP path, and a matched swap is harmless late.
// Unquoted names on purpose: React escapes quotes inside <style> text and the CSS would break.
const LATIN = "unicode-range:U+0000-024F,U+2000-206F,U+20AC,U+2122";
const FALLBACK_FACES = [
  `@font-face{font-family:DM Sans Fallback;src:local(Arial),local(ArialMT),local(Liberation Sans),local(LiberationSans-Regular),local(Arimo),local(Helvetica);font-weight:400;size-adjust:105.07%;ascent-override:94.41%;descent-override:29.5%;line-gap-override:0%;${LATIN}}`,
  `@font-face{font-family:DM Sans Fallback;src:local(Arial Bold),local(Arial-BoldMT),local(Liberation Sans Bold),local(LiberationSans-Bold),local(Arimo Bold),local(Arimo-Bold),local(Helvetica Bold);font-weight:600;size-adjust:101.55%;ascent-override:97.69%;descent-override:30.53%;line-gap-override:0%;${LATIN}}`,
].join("");
const FONT_STACK = '"DM Sans", "DM Sans Fallback", ui-sans-serif, system-ui, sans-serif';

export function MarketingShell({
  appName,
  children,
  locale = "en",
  path = "/",
}: {
  appName: string;
  children: ReactNode;
  locale?: FrontLocale;
  path?: "/" | "/pricing";
}) {
  const l = locale;
  const other: FrontLocale = l === "en" ? "ar" : "en";
  return (
    <div
      className="flex min-h-screen flex-col bg-brand-surface font-brand text-brand-ink"
      style={{ fontFamily: FONT_STACK }}>
      <style>{FALLBACK_FACES}</style>
      <header className="border-brand-border border-b bg-brand-surface-alt">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href={frontPath(l, "/")} className="font-semibold text-brand-primary text-xl">
            {appName}
          </Link>
          <div className="flex items-center gap-5 text-sm">
            <Link href={frontPath(l, "/pricing")} className="hover:underline">
              {ft(l, "navPricing")}
            </Link>
            <Link href={frontPath(other, path)} hrefLang={other} lang={other} className="hover:underline">
              {ft(l, "navOtherLang")}
            </Link>
            <Link href="/login" className="hover:underline">
              {ft(l, "navLogin")}
            </Link>
            <Link
              href="/signup"
              className="rounded-brand-md bg-brand-primary px-4 py-2 font-semibold text-brand-surface-alt">
              {ft(l, "navStart")}
            </Link>
          </div>
        </nav>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-brand-border border-t bg-brand-surface-alt">
        <div className="mx-auto max-w-6xl px-6 py-8 text-brand-ink-muted text-sm">
          <p>
            © {new Date().getFullYear()} {LEGAL_ENTITY.name} · {LEGAL_ENTITY.address}
          </p>
          <p className="mt-2 flex flex-wrap gap-4">
            <Link href={frontPath(l, "/pricing")} className="hover:underline">
              {ft(l, "navPricing")}
            </Link>
            <Link href="/terms" className="hover:underline">
              {ft(l, "footerTerms")}
            </Link>
            <Link href="/privacy" className="hover:underline">
              {ft(l, "footerPrivacy")}
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
