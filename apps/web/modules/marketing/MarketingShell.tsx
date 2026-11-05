import Link from "next/link";
import type { ReactNode } from "react";
import { LEGAL_ENTITY } from "~/legal/content";

// L8-6-TW: server-rendered shell for the signed-out front door (no client JS, no session needed).
export function MarketingShell({ appName, children }: { appName: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-brand-surface font-brand text-brand-ink">
      <header className="border-brand-border border-b bg-brand-surface-alt">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="font-semibold text-brand-primary text-xl">
            {appName}
          </Link>
          <div className="flex items-center gap-5 text-sm">
            <Link href="/pricing" className="hover:underline">
              Pricing
            </Link>
            <Link href="/login" className="hover:underline">
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-brand-md bg-brand-primary px-4 py-2 font-semibold text-brand-surface-alt">
              Start free
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
            <Link href="/pricing" className="hover:underline">
              Pricing
            </Link>
            <Link href="/terms" className="hover:underline">
              Terms of Service
            </Link>
            <Link href="/privacy" className="hover:underline">
              Privacy Policy
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
