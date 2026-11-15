import { getSession } from "@calcom/features/auth/lib/userFromSessionUtils";
import { publicLookupForPublicEvent, resolvePublicTwOrg } from "@calcom/lib/server/tw-org-scope/public";
import { runWithTwOrg } from "@calcom/prisma/tw-org-context";
import publicProcedure from "../../../procedures/publicProcedure";
import { ZEventInputSchema } from "../event.schema";

export const event = publicProcedure.input(ZEventInputSchema).query(async (opts) => {
  const session = await getSession(opts.ctx);
  const userId = session?.user?.id;
  const { default: handler } = await import("../event.handler");

  // TW-BOOKING-404: a logged-out booker has no session org, so forced RLS on EventType/users
  // returned no row and the booker rendered "could not find the event". Resolve the org from
  // the team slug / username(s) through the TW-T9.2a definer functions, as slots.getSchedule does.
  const twOrgId = await resolvePublicTwOrg(opts.ctx.prisma, publicLookupForPublicEvent(opts.input));
  if (!twOrgId) return null;
  return runWithTwOrg(twOrgId, () => handler({ input: opts.input, userId }));
});
