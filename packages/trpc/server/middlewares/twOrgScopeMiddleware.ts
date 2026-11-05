import { readSessionTwOrgId, runWithSessionTwOrg, twOrgIdOf } from "@calcom/lib/server/tw-org-scope/session";

type TwOrgScopeCtx = {
  session?: { user?: { twOrgId?: unknown } | null } | null;
  req?: unknown;
};

/**
 * TW-T9.2b1: applied to the base procedure, so every tRPC call (public and authed) runs
 * in the caller's org scope. The org comes from the session already on the context or
 * the signed session cookie; procedure input is never consulted (CC-13).
 */
export async function twOrgScope<R>({
  ctx,
  next,
}: {
  ctx: TwOrgScopeCtx;
  next: () => Promise<R>;
}): Promise<R> {
  const twOrgId = twOrgIdOf(ctx.session?.user) ?? (await readSessionTwOrgId(ctx.req));
  return runWithSessionTwOrg(twOrgId, next);
}
