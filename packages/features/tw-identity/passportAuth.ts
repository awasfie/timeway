import type { JWTVerifyGetKey } from "jose";

import { verifyPassportGrant, type PassportGrant } from "./passportGrant";

export class PassportAuthError extends Error {
  constructor(public readonly code: "invalid_grant" | "not_provisioned" | "org_inactive" | "locked") {
    super(code);
    this.name = "PassportAuthError";
  }
}

export interface PassportAuthDeps {
  baseUrl?: string;
  keys?: JWTVerifyGetKey;
  findUserByEmail(email: string): Promise<{ id: number; email: string; username: string | null; locked: boolean } | null>;
  /** Timeway Organization mirrored from Passport: Organization.externalRef = passportOrgId. */
  findOrgByExternalRef(passportOrgId: string): Promise<{ id: string; status: "active" | "suspended" | "closed"; identityMode: "local" | "passport" } | null>;
  /** Replay guard for the one-time grant (jti). Returns false when already seen. */
  claimJti?(jti: string, ttlSeconds: number): Promise<boolean>;
}

export interface PassportSignIn {
  userId: number;
  email: string;
  username: string | null;
  twOrgId: string;
  grant: PassportGrant;
}

/**
 * Passport-mode sign-in: verify the grant, resolve the provisioned user and the mirrored org.
 * Nothing is created here — accounts and orgs arrive through /internal/provision (ID.6a);
 * an unknown account is refused as `not_provisioned`, never auto-created from a token.
 */
export async function authorizePassportGrant(grantToken: string | undefined, deps: PassportAuthDeps): Promise<PassportSignIn> {
  if (!grantToken) throw new PassportAuthError("invalid_grant");
  let grant: PassportGrant;
  try {
    grant = await verifyPassportGrant(grantToken, { baseUrl: deps.baseUrl, keys: deps.keys });
  } catch {
    throw new PassportAuthError("invalid_grant");
  }
  if (grant.jti && deps.claimJti && !(await deps.claimJti(grant.jti, 120))) throw new PassportAuthError("invalid_grant");

  const user = await deps.findUserByEmail(grant.email);
  if (!user) throw new PassportAuthError("not_provisioned");
  if (user.locked) throw new PassportAuthError("locked");

  for (const passportOrgId of grant.organizationIds) {
    const org = await deps.findOrgByExternalRef(passportOrgId);
    if (!org || org.identityMode !== "passport") continue;
    if (org.status !== "active") throw new PassportAuthError("org_inactive");
    return { userId: user.id, email: user.email, username: user.username, twOrgId: org.id, grant };
  }
  throw new PassportAuthError("not_provisioned");
}
