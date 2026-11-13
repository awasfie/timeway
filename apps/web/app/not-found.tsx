import { _generateMetadata } from "app/_utils";
import { headers } from "next/headers";
import { getAppProviderProps } from "./AppProvidersServer";
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

// UX.13.3-3b: the root not-found is in every route's first-load entry set, so it must not import
// the app providers statically. It passes their props to the lazy body, which mounts them.
const ServerPage = async () => {
  const h = await headers();
  const nonce = h.get("x-csp-nonce") ?? undefined;
  const host = h.get("x-forwarded-host") ?? "";

  const appProviderProps = await getAppProviderProps();

  return <NotFoundLazy nonce={nonce} host={host} appProviderProps={appProviderProps} />;
};
export default ServerPage;
