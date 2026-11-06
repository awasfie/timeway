/**
 * TW-T9 user org provisioning (t_9824b7a7, Q-18).
 *
 * After FORCE RLS (TW-T9.2d) a user row with a NULL twOrgId is visible only in a platform
 * scope, so a webapp signup would be dark under timeway_app. Every new user therefore gets
 * an org at once: the single org of their accepted team co-members if there is one, else a
 * personal tw_organization with the user as owner. The rules live in one place, the SQL
 * function public.tw_ensure_user_org (migration 20261105120400), which the backfill script
 * uses too.
 *
 * Platform scopes on request paths are reviewed by name; these are the only two:
 *   - "signup-provision": the signup route (unauthenticated by design). Email and username
 *     are unique across all orgs, so the handler's uniqueness reads and the user insert span
 *     orgs; the scope ends when the handler returns.
 *   - "tw-user-org-provision": login of an existing user who has no org yet (credentials
 *     only after the password check passed, OAuth only after the IdP verified the user),
 *     and the provisioning call itself.
 */
import { prisma } from "@calcom/prisma";
import type { RawCapableTx, TxCapableClient } from "@calcom/prisma/tw-org-context";
import { runWithTwPlatform, withTwPlatform } from "@calcom/prisma/tw-org-context";

import { resolveLoginPrincipal, twOrgIdOf } from "./session";

export const TW_SIGNUP_PLATFORM_REASON = "signup-provision";
export const TW_USER_ORG_PROVISION_REASON = "tw-user-org-provision";

type RawTx = RawCapableTx & {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};
type ProvisionClient = TxCapableClient<RawTx> & {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

/**
 * Gives the user an org (idempotent) and returns it. NULL when the user does not exist or
 * holds more than one candidate org (left to an operator; the login then opens no scope).
 */
export async function ensureUserTwOrg(
  userId: number,
  client: ProvisionClient = prisma as unknown as ProvisionClient
): Promise<string | null> {
  if (!Number.isInteger(userId) || userId <= 0) return null;
  const rows = await withTwPlatform(client, TW_USER_ORG_PROVISION_REASON, (tx) =>
    tx.$queryRaw<{ twOrgId: string | null }[]>`
      select public.tw_ensure_user_org(${userId}::integer)::text as "twOrgId"`
  );
  return twOrgIdOf(rows?.[0]);
}

/** Runs the signup handler in the reviewed "signup-provision" platform scope. */
export function runSignupProvision<R>(fn: () => R | PromiseLike<R>): Promise<R> {
  return runWithTwPlatform(TW_SIGNUP_PLATFORM_REASON, fn);
}

/** Runs a login step for a verified, still org-less user in the reviewed provisioning scope. */
export function runOrglessLogin<R>(fn: () => R | PromiseLike<R>): Promise<R> {
  return runWithTwPlatform(TW_USER_ORG_PROVISION_REASON, fn);
}

/**
 * After an OAuth signIn passed with no org (new user created inside signIn, or an org-less
 * existing one): finds the user row by the IdP email through the definer lookup and gives it
 * an org. The IdP user id is never used as a row id (it is the provider's id, not ours).
 */
export async function provisionSignedInUser(
  user: { email?: string | null } | null | undefined,
  _account?: unknown,
  client: ProvisionClient = prisma as unknown as ProvisionClient
): Promise<string | null> {
  const principal = await runOrglessLogin(() => resolveLoginPrincipal(client, user?.email));
  if (!principal) return null;
  return principal.twOrgId ?? ensureUserTwOrg(principal.id, client);
}
