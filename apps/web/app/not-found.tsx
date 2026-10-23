import { _generateMetadata } from "app/_utils";
import { headers } from "next/headers";

import PageWrapper from "@components/PageWrapperAppDir";

import { AuthedAppProviders } from "./AuthedAppProviders";
import { NotFound } from "./notFoundClient";

export const generateMetadata = async () => {
  const metadata = await _generateMetadata(
    (t) => t("404_page_not_found"),
    (t) => t("404_page_not_found")
  );
  return {
    ...metadata,
    robots: {
      index: false,
      follow: false,
    },
  };
};

const ServerPage = async () => {
  const h = await headers();
  const nonce = h.get("x-csp-nonce") ?? undefined;
  const host = h.get("x-forwarded-host") ?? "";

  return (
    <AuthedAppProviders isEmbed={h.get("x-isEmbed") === "true"}>
      <PageWrapper requiresLicense={false} nonce={nonce}>
        <NotFound host={host} />
      </PageWrapper>
    </AuthedAppProviders>
  );
};
export default ServerPage;
