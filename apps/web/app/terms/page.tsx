import { _generateMetadataForStaticPage } from "app/_utils";
import type { Metadata } from "next";
import type { JSX } from "react";

import { APP_NAME, SUPPORT_MAIL_ADDRESS, WEBSITE_URL } from "@calcom/lib/constants";

import { LegalDocument } from "~/legal/LegalDocument";
import { termsContent } from "~/legal/content";

// CM-T6: Timeway Terms of Service (replaces the upstream cal.com/terms link).
export const dynamic = "force-static";

export const generateMetadata = async (): Promise<Metadata> =>
  await _generateMetadataForStaticPage(
    "Terms of Service",
    `The terms for using ${APP_NAME}.`,
    undefined,
    undefined,
    "/terms"
  );

export default function TermsPage(): JSX.Element {
  return (
    <LegalDocument content={termsContent(APP_NAME, SUPPORT_MAIL_ADDRESS, WEBSITE_URL)} appName={APP_NAME} />
  );
}
