import { _generateMetadata } from "app/_utils";
import { headers } from "next/headers";
import { AppProviders, getAppProviderProps } from "./AppProvidersServer";
import { NotFoundLazy } from "./notFoundLazy";

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

  const appProviderProps = await getAppProviderProps();

  return (
    <AppProviders {...appProviderProps}>
      <NotFoundLazy nonce={nonce} host={host} />
    </AppProviders>
  );
};
export default ServerPage;
