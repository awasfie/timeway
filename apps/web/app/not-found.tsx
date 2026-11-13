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

// UX.13.3-3d: Next serialises the root not-found boundary into every route's RSC payload, so
// whatever this passes down is inlined into the HTML of /, /pricing, ... Passing the full
// common.json here cost 302 KB raw on /. The 404 body (notFoundClient.tsx) uses only these keys;
// keep the list in step with it.
const NOT_FOUND_KEYS = [
  "error_404",
  "page_doesnt_exist",
  "check_spelling_mistakes_or_go_back",
  "404_the_user",
  "404_claim_entity_user",
  "is_still_available",
  "register_now",
  "register",
  "popular_pages",
  "documentation",
  "documentation_description",
  "blog",
  "blog_description",
  "or_go_back_home",
] as const;

// UX.13.3-3b: the root not-found is in every route's first-load entry set, so it must not import
// the app providers statically. It passes their props to the lazy body, which mounts them.
const ServerPage = async () => {
  const h = await headers();
  const nonce = h.get("x-csp-nonce") ?? undefined;
  const host = h.get("x-forwarded-host") ?? "";

  const { translations, ...rest } = await getAppProviderProps();
  const appProviderProps = {
    ...rest,
    translations: Object.fromEntries(
      NOT_FOUND_KEYS.filter((k) => k in translations).map((k) => [k, translations[k]])
    ),
  };

  return <NotFoundLazy nonce={nonce} host={host} appProviderProps={appProviderProps} />;
};
export default ServerPage;
