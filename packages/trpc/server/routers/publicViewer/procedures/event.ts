import { getSession } from "@calcom/features/auth/lib/userFromSessionUtils";
import { publicLookupsForEventInput, resolvePublicTwOrgFirst } from "@calcom/lib/server/tw-org-scope/public";
import { runWithTwOrg } from "@calcom/prisma/tw-org-context";
import publicProcedure from "../../../procedures/publicProcedure";
import { ZEventInputSchema } from "../event.schema";

export const event = publicProcedure.input(ZEventInputSchema).query(async (opts) => {
  const session = await getSession(opts.ctx);
  const userId = session?.user?.id;
  const { default: handler } = await import("../event.handler");

  const twOrgId = await resolvePublicTwOrgFirst(opts.ctx.prisma, publicLookupsForEventInput(opts.input));
  // No resolvable org: same "event not found" answer the page already renders for json:null.
  if (!twOrgId) return null;

  return runWithTwOrg(twOrgId, () => handler({ input: opts.input, userId }));
});
