import Link from "next/link";
import type { ReactNode } from "react";
import { LEGAL_ENTITY } from "~/legal/content";
import { type FrontLocale, frontPath, ft } from "./i18n";

// L8-6-TW: server-rendered shell for the signed-out front door (no client JS, no session needed).
// FRONT-DOOR-timeway: EN at /, /pricing; AR at /ar, /ar/pricing (the root layout sets lang/dir from the path).
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
    <div className="flex min-h-screen flex-col bg-brand-surface font-brand text-brand-ink">
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
