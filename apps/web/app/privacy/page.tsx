import { _generateMetadataForStaticPage, getTranslate } from "app/_utils";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";

import { getLocale } from "@calcom/features/auth/lib/getLocale";

import { APP_NAME, SUPPORT_MAIL_ADDRESS } from "@calcom/lib/constants";

import { buildLegacyRequest } from "@lib/buildLegacyCtx";

import { LegalDocument } from "~/legal/LegalDocument";
import { privacyContent } from "~/legal/content";

// CM-T6: Timeway Privacy Policy (replaces the upstream cal.com/privacy link).
// Rendered per request so the visitor's locale (cookie / Accept-Language) picks the en or ar text.
export const dynamic = "force-dynamic";

export const generateMetadata = async (): Promise<Metadata> =>
  await _generateMetadataForStaticPage(
    "Privacy Policy",
    `How ${APP_NAME} collects and uses personal data.`,
    undefined,
    undefined,
    "/privacy"
  );

export default async function PrivacyPage(){
  const locale = (await getLocale(buildLegacyRequest(await headers(), await cookies()))) ?? "en";
  const t = await getTranslate();
  return (
    <LegalDocument content={privacyContent(APP_NAME, SUPPORT_MAIL_ADDRESS, locale)} appName={APP_NAME} t={t} locale={locale} />
  );
}
