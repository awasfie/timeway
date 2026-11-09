import { runWithTwPlatform } from "@calcom/prisma/tw-org-context";

export const API_V2_AUTH_PRINCIPAL_REASON = "api-v2-auth-principal";

/**
 * TW-T9.2b1: the auth guards look up the principal (API key, access token, OAuth client,
 * session subject -> user) before any org is known, so those reads alone run in platform
 * scope. The scope ends when the lookup resolves; the handler runs in the user's org via
 * TwOrgScopeInterceptor.
 */
export function inAuthPrincipalScope<R>(fn: () => Promise<R>): Promise<R> {
  return runWithTwPlatform(API_V2_AUTH_PRINCIPAL_REASON, fn);
}
