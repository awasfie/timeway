import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

export const TW_PRODUCT_CODE = "timeway";

export interface PassportGrant {
  accountId: string;
  email: string;
  organizationIds: string[];
  jti?: string;
}

export interface VerifyGrantOptions {
  /** Passport base URL (JWKS at /.well-known/jwks.json). Ignored when `keys` is given. */
  baseUrl?: string;
  keys?: JWTVerifyGetKey;
  product?: string;
  now?: () => number;
}

const ENTITLEMENT_TYP = "passport-entitlements+jwt";
const keyCache = new Map<string, JWTVerifyGetKey>();

function keysFor(o: VerifyGrantOptions): JWTVerifyGetKey {
  if (o.keys) return o.keys;
  if (!o.baseUrl) throw new Error("PASSPORT_BASE_URL not configured");
  let k = keyCache.get(o.baseUrl);
  if (!k) {
    k = createRemoteJWKSet(new URL("/.well-known/jwks.json", o.baseUrl));
    keyCache.set(o.baseUrl, k);
  }
  return k;
}

/** Verify a Passport session grant (iss=passport, aud=timeway, short-lived) and return its identity. */
export async function verifyPassportGrant(token: string, o: VerifyGrantOptions): Promise<PassportGrant> {
  const { payload, protectedHeader } = await jwtVerify(token, keysFor(o), {
    issuer: "passport",
    audience: o.product ?? TW_PRODUCT_CODE,
    algorithms: ["RS256"],
    currentDate: o.now ? new Date(o.now()) : undefined,
  });
  if (protectedHeader.typ === ENTITLEMENT_TYP) throw new Error("entitlement snapshot is not a session grant");
  const email = payload.email;
  const orgs = payload.organizationIds;
  if (typeof payload.sub !== "string" || typeof email !== "string" || !email.includes("@")) {
    throw new Error("grant missing sub/email");
  }
  if (!Array.isArray(orgs) || orgs.some((x) => typeof x !== "string")) throw new Error("grant missing organizationIds");
  return { accountId: payload.sub, email: email.toLowerCase(), organizationIds: orgs as string[], jti: payload.jti };
}
