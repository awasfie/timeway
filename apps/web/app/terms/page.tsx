import { getLocale } from "@calcom/features/auth/lib/getLocale";
import { APP_NAME, SUPPORT_MAIL_ADDRESS, WEBSITE_URL } from "@calcom/lib/constants";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { _generateMetadataForStaticPage, getTranslate } from "app/_utils";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { termsContent } from "~/legal/content";
import { LegalDocument } from "~/legal/LegalDocument";

// CM-T6: Timeway Terms of Service (replaces the upstream cal.com/terms link).
// Rendered per request so the visitor's locale (cookie / Accept-Language) picks the en or ar text.
export const dynamic = "force-dynamic";

export const generateMetadata = async (): Promise<Metadata> =>
  await _generateMetadataForStaticPage(
    "Terms of Service",
    `The terms for using ${APP_NAME}.`,
    undefined,
    undefined,
    "/terms"
  );

export default async function TermsPage() {
  const locale = (await getLocale(buildLegacyRequest(await headers(), await cookies()))) ?? "en";
  const t = await getTranslate();
  return (
    <LegalDocument
      content={termsContent(APP_NAME, SUPPORT_MAIL_ADDRESS, WEBSITE_URL, locale)}
      appName={APP_NAME}
      t={t}
      locale={locale}
    />
  );
}
