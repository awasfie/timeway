import Link from "next/link";

import type { TFunction } from "i18next";

import { LEGAL_ENTITY, type LegalDocumentContent, legalLastUpdated } from "./content";

/** CM-T6: server-rendered legal document (no client JS, readable without sign-in). */
export function LegalDocument({
  content,
  appName,
  t,
  locale,
}: {
  content: LegalDocumentContent;
  appName: string;
  t: TFunction;
  locale: string;
}){
  return (
    <main className="min-h-screen bg-default text-default">
      <article className="mx-auto max-w-3xl px-6 py-12 md:py-16">
        <p className="mb-2 text-sm text-subtle">
          <Link href="/" className="hover:underline">
            {appName}
          </Link>
        </p>
        <h1 className="font-cal font-semibold text-3xl text-emphasis">{content.title}</h1>
        <p className="mt-2 text-sm text-subtle">{t("last_updated")}: {legalLastUpdated(locale)}</p>
        <p className="mt-6 leading-relaxed">{content.intro}</p>
        {content.sections.map((s) => (
          <section key={s.id} id={s.id} className="mt-8">
            <h2 className="font-semibold text-emphasis text-xl">{s.heading}</h2>
            {s.paragraphs.map((p) => (
              <p key={p} className="mt-3 leading-relaxed">
                {p}
              </p>
            ))}
            {s.bullets && (
              <ul className="mt-3 list-disc space-y-2 ps-6 leading-relaxed">
                {s.bullets.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            )}
          </section>
        ))}
        <footer className="mt-12 border-subtle border-t pt-6 text-sm text-subtle">
          <p>
            {LEGAL_ENTITY.name} · {LEGAL_ENTITY.address} · {t("legal_uae_vat_trn")} {LEGAL_ENTITY.trn}
          </p>
          <p className="mt-2">
            <Link href="/terms" className="hover:underline">
              {t("terms_of_service")}
            </Link>{" "}
            ·{" "}
            <Link href="/privacy" className="hover:underline">
              {t("privacy_policy")}
            </Link>
          </p>
        </footer>
      </article>
    </main>
  );
}
