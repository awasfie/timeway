import type { GatewayCurrency } from "./money";
import type { GatewayProviderSlug } from "./types";

type GatewayProviderInfo = {
  /** ISO 3166-1 alpha-2 countries where the provider is suggested first. Empty = global. */
  countries: readonly string[];
  currencies: readonly GatewayCurrency[];
};

const GCC = ["SA", "AE", "KW", "BH", "OM", "QA"] as const;
const GCC_CURRENCIES = ["SAR", "AED", "KWD", "BHD", "OMR", "QAR", "USD"] as const;

/**
 * Advisory only (WC-TW-13 G4): it orders the app list for an org's country. Any org may install any app.
 */
export const GATEWAY_PROVIDERS: Readonly<Record<GatewayProviderSlug, GatewayProviderInfo>> = {
  tap: { countries: GCC, currencies: GCC_CURRENCIES },
  paytabs: { countries: GCC, currencies: [...GCC_CURRENCIES, "EGP"] },
  paymob: { countries: ["EG"], currencies: ["EGP", "USD"] },
  stripe: { countries: [], currencies: ["SAR", "AED", "EGP", "USD", "KWD", "BHD", "OMR", "QAR"] },
};

const PROVIDER_ORDER: readonly GatewayProviderSlug[] = ["tap", "paytabs", "paymob", "stripe"];

/** Regional providers for the country first, then global ones. Unknown or missing country: global only. */
export function suggestedProviders(countryCode: string | null | undefined): GatewayProviderSlug[] {
  const country = countryCode?.trim().toUpperCase() ?? "";
  const regional = PROVIDER_ORDER.filter((slug) => GATEWAY_PROVIDERS[slug].countries.includes(country));
  const global = PROVIDER_ORDER.filter((slug) => GATEWAY_PROVIDERS[slug].countries.length === 0);
  return [...regional, ...global];
}

/** Every provider, suggested ones first: the full app-store ordering for an org. */
export function orderedProviders(countryCode: string | null | undefined): GatewayProviderSlug[] {
  const suggested = suggestedProviders(countryCode);
  return [...suggested, ...PROVIDER_ORDER.filter((slug) => !suggested.includes(slug))];
}

export function providerSupportsCurrency(slug: GatewayProviderSlug, currency: string): boolean {
  return (GATEWAY_PROVIDERS[slug].currencies as readonly string[]).includes(currency.toUpperCase());
}
