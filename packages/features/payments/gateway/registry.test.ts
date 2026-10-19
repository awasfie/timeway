import { describe, expect, it } from "vitest";
import { orderedProviders, providerSupportsCurrency, suggestedProviders } from "./registry";

describe("gateway registry (WC-TW-13 G4)", () => {
  it.each(["SA", "AE", "KW", "BH", "OM", "QA"])("%s suggests Tap and PayTabs, then Stripe", (country) => {
    expect(suggestedProviders(country)).toEqual(["tap", "paytabs", "stripe"]);
  });

  it("EG suggests Paymob, then Stripe", () => {
    expect(suggestedProviders("EG")).toEqual(["paymob", "stripe"]);
    expect(suggestedProviders("eg")).toEqual(["paymob", "stripe"]);
  });

  it("unknown or missing country suggests Stripe only", () => {
    expect(suggestedProviders("GB")).toEqual(["stripe"]);
    expect(suggestedProviders(null)).toEqual(["stripe"]);
    expect(suggestedProviders(undefined)).toEqual(["stripe"]);
    expect(suggestedProviders("")).toEqual(["stripe"]);
  });

  it("orderedProviders keeps every provider installable", () => {
    expect(orderedProviders("EG")).toEqual(["paymob", "stripe", "tap", "paytabs"]);
    expect(orderedProviders("GB")).toEqual(["stripe", "tap", "paytabs", "paymob"]);
  });

  it("currency support", () => {
    expect(providerSupportsCurrency("tap", "kwd")).toBe(true);
    expect(providerSupportsCurrency("paymob", "EGP")).toBe(true);
    expect(providerSupportsCurrency("paymob", "SAR")).toBe(false);
  });
});
