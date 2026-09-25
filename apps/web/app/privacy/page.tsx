import { _generateMetadataForStaticPage } from "app/_utils";
import type { Metadata } from "next";
import type { JSX } from "react";

import { APP_NAME, SUPPORT_MAIL_ADDRESS } from "@calcom/lib/constants";

import { LegalDocument } from "~/legal/LegalDocument";
import { privacyContent } from "~/legal/content";

// CM-T6: Timeway Privacy Policy (replaces the upstream cal.com/privacy link).
export const dynamic = "force-static";

export const generateMetadata = async (): Promise<Metadata> =>
  await _generateMetadataForStaticPage(
    "Privacy Policy",
    `How ${APP_NAME} collects and uses personal data.`,
    undefined,
    undefined,
    "/privacy"
  );

export default function PrivacyPage(): JSX.Element {
  return <LegalDocument content={privacyContent(APP_NAME, SUPPORT_MAIL_ADDRESS)} appName={APP_NAME} />;
}
