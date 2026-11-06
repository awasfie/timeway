/**
 * TW-T10 — request auth for /api/v2/orgs/*: platform master key (org-create) or a per-org key.
 * The org id for org-scoped calls comes from the verified key row, never from the client; a
 * path orgId that differs from the key's org answers 404 (no existence oracle, CC-13).
 */
import type { RawCapableTx, TxCapableClient } from "@calcom/prisma/tw-org-context";
import { withTwPlatform } from "@calcom/prisma/tw-org-context";
import { bearerToken, hasScope, isPlatformMasterKey, orgKeyMatches, parseOrgKey } from "./keys";

export type AuthResult =
  | { kind: "platform" }
  | { kind: "org"; orgId: string; keyId: string; scopes: string[] }
  | { kind: "denied"; status: 401 | 403 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
export interface AuthTx extends RawCapableTx {
  orgApiKey: Any;
}
export type AuthClient = TxCapableClient<AuthTx>;

export async function authenticate(
  client: AuthClient,
  authorization: string | null | undefined
): Promise<AuthResult> {
  const token = bearerToken(authorization);
  if (!token) return { kind: "denied", status: 401 };
  if (isPlatformMasterKey(token)) return { kind: "platform" };
  const parsed = parseOrgKey(token);
  if (!parsed) return { kind: "denied", status: 401 };
  const row: {
    id: string;
    orgId: string;
    hashedKey: string;
    scopes: string[];
    revokedAt: Date | null;
  } | null = await withTwPlatform(client, "TW-T10 org key lookup", (tx) =>
    tx.orgApiKey.findUnique({
      where: { prefix: parsed.prefix },
      select: { id: true, orgId: true, hashedKey: true, scopes: true, revokedAt: true },
    })
  );
  if (!row || !orgKeyMatches(token, row)) return { kind: "denied", status: 401 };
  return { kind: "org", orgId: row.orgId, keyId: row.id, scopes: row.scopes };
}

export function requireScope(auth: AuthResult, scope: string): boolean {
  return auth.kind === "org" && hasScope(auth.scopes, scope);
}
