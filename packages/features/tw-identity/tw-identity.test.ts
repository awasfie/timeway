import { generateKeyPair, SignJWT, exportJWK, createLocalJWKSet } from "jose";
import { describe, expect, it, vi } from "vitest";

import { authorizePassportGrant, PassportAuthError } from "./passportAuth";
import { assertIdentityConfig, resolveIdentityMode, TwIdentityModeError } from "./mode";
import { gateStripe, StripeDisabledInPassportMode } from "./stripeGate";

const ORG_P = "11111111-1111-4111-8111-111111111111";
const TW_ORG = "22222222-2222-4222-8222-222222222222";

async function setup() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const sign = (over: Record<string, unknown> = {}, aud = "timeway", exp: string | number = "2m", iss = "passport") =>
    new SignJWT({ email: "Owner@Example.com", organizationIds: [ORG_P], ...over })
      .setProtectedHeader({ alg: "RS256", kid: "k1" })
      .setIssuer(iss).setAudience(aud).setSubject("acc-1").setJti(crypto.randomUUID())
      .setIssuedAt().setExpirationTime(exp).sign(privateKey);
  return { keys, sign };
}

const deps = (keys: any, o: any = {}) => ({
  keys,
  findUserByEmail: vi.fn(async (e: string) => (e === "owner@example.com" ? { id: 7, email: e, username: "owner", locked: false, ...o.user } : null)),
  findOrgByExternalRef: vi.fn(async (r: string) => (r === ORG_P ? { id: TW_ORG, status: "active" as const, identityMode: "passport" as const, ...o.org } : null)),
  claimJti: o.claimJti,
});

describe("TW-T14 identity mode switch", () => {
  it("defaults to local; accepts passport/local; rejects typos", () => {
    expect(resolveIdentityMode({})).toBe("local");
    expect(resolveIdentityMode({ TW_IDENTITY_MODE: "Passport" })).toBe("passport");
    expect(resolveIdentityMode({ TW_IDENTITY_MODE: "local" })).toBe("local");
    expect(() => resolveIdentityMode({ TW_IDENTITY_MODE: "pasport" })).toThrow(TwIdentityModeError);
  });
  it("passport mode boot needs PASSPORT_BASE_URL and no STRIPE* vars; local boots bare", () => {
    expect(assertIdentityConfig({})).toBe("local");
    expect(assertIdentityConfig({ TW_IDENTITY_MODE: "local", STRIPE_PRIVATE_KEY: "x" })).toBe("local");
    expect(() => assertIdentityConfig({ TW_IDENTITY_MODE: "passport" })).toThrow(/PASSPORT_BASE_URL/);
    expect(() => assertIdentityConfig({ TW_IDENTITY_MODE: "passport", PASSPORT_BASE_URL: "https://p", STRIPE_PRIVATE_KEY: "x" })).toThrow(/STRIPE/);
    expect(assertIdentityConfig({ TW_IDENTITY_MODE: "passport", PASSPORT_BASE_URL: "https://p" })).toBe("passport");
  });
});

describe("CC-36 zero Stripe calls in passport mode", () => {
  it("passport: any Stripe client access throws before a network call; local: passes through", async () => {
    const customers = { create: vi.fn(async () => ({ id: "cus_1" })) };
    const client = { customers };
    const env: Record<string, string | undefined> = { TW_IDENTITY_MODE: "passport" };
    const stripe = gateStripe(client, () => env);
    expect(() => stripe.customers).toThrow(StripeDisabledInPassportMode);
    expect(customers.create).not.toHaveBeenCalled();
    env.TW_IDENTITY_MODE = "local";
    await expect(stripe.customers.create()).resolves.toEqual({ id: "cus_1" });
    expect(customers.create).toHaveBeenCalledTimes(1);
  });
});

describe("TW-T14 passport sign-in", () => {
  it("valid grant → provisioned user + mirrored org", async () => {
    const { keys, sign } = await setup();
    const r = await authorizePassportGrant(await sign(), deps(keys));
    expect(r).toMatchObject({ userId: 7, twOrgId: TW_ORG, email: "owner@example.com" });
  });
  it.each([
    ["wrong audience", (s: any) => s({}, "camv")],
    ["wrong issuer", (s: any) => s({}, "timeway", "2m", "evil")],
    ["expired", (s: any) => s({}, "timeway", Math.floor(Date.now() / 1000) - 60)],
  ])("%s → invalid_grant", async (_n, mk) => {
    const { keys, sign } = await setup();
    await expect(authorizePassportGrant(await mk(sign), deps(keys))).rejects.toMatchObject({ code: "invalid_grant" });
  });
  it("garbage / missing token → invalid_grant", async () => {
    const { keys } = await setup();
    await expect(authorizePassportGrant("x.y.z", deps(keys))).rejects.toBeInstanceOf(PassportAuthError);
    await expect(authorizePassportGrant(undefined, deps(keys))).rejects.toMatchObject({ code: "invalid_grant" });
  });
  it("token signed by another key is refused", async () => {
    const a = await setup(); const b = await setup();
    await expect(authorizePassportGrant(await b.sign(), deps(a.keys))).rejects.toMatchObject({ code: "invalid_grant" });
  });
  it("unknown user / org not mirrored / local-mode org → not_provisioned (never auto-created)", async () => {
    const { keys, sign } = await setup();
    await expect(authorizePassportGrant(await sign({ email: "nobody@example.com" }), deps(keys))).rejects.toMatchObject({ code: "not_provisioned" });
    await expect(authorizePassportGrant(await sign({ organizationIds: ["99999999-9999-4999-8999-999999999999"] }), deps(keys))).rejects.toMatchObject({ code: "not_provisioned" });
    await expect(authorizePassportGrant(await sign(), deps(keys, { org: { identityMode: "local" } }))).rejects.toMatchObject({ code: "not_provisioned" });
  });
  it("locked user and suspended org are refused", async () => {
    const { keys, sign } = await setup();
    await expect(authorizePassportGrant(await sign(), deps(keys, { user: { locked: true } }))).rejects.toMatchObject({ code: "locked" });
    await expect(authorizePassportGrant(await sign(), deps(keys, { org: { status: "suspended" } }))).rejects.toMatchObject({ code: "org_inactive" });
  });
  it("replayed grant (jti) is refused", async () => {
    const { keys, sign } = await setup();
    const seen = new Set<string>();
    const claimJti = async (j: string) => (seen.has(j) ? false : (seen.add(j), true));
    const t = await sign();
    await expect(authorizePassportGrant(t, deps(keys, { claimJti }))).resolves.toBeTruthy();
    await expect(authorizePassportGrant(t, deps(keys, { claimJti }))).rejects.toMatchObject({ code: "invalid_grant" });
  });
});
