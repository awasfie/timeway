import { gateStripe, assertStripeAllowed, isPassportMode, StripeDisabledInPassportMode } from "./identityGate";

describe("v2 stripe identity gate (CC-36)", () => {
  const client = { customers: { create: () => "called" } };

  it("local mode passes through", () => {
    const g = gateStripe(client, () => ({ TW_IDENTITY_MODE: "local" }));
    expect(g.customers.create()).toBe("called");
    expect(() => assertStripeAllowed("x", {})).not.toThrow();
  });

  it("passport mode throws on any property access and assert", () => {
    const g = gateStripe(client, () => ({ TW_IDENTITY_MODE: "passport" }));
    expect(() => g.customers).toThrow(StripeDisabledInPassportMode);
    expect(() => assertStripeAllowed("x", { TW_IDENTITY_MODE: "passport" })).toThrow(StripeDisabledInPassportMode);
  });

  it("unknown mode is a boot error, never a fallback", () => {
    expect(() => isPassportMode({ TW_IDENTITY_MODE: "pasport" })).toThrow();
  });
});
