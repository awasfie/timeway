import { getSession } from "@calcom/features/auth/lib/userFromSessionUtils";
import { publicLookupForSchedule, resolvePublicTwOrg } from "@calcom/lib/server/tw-org-scope/public";
import { runWithTwOrg } from "@calcom/prisma/tw-org-context";
import publicProcedure from "../../../procedures/publicProcedure";
import { ZEventInputSchema } from "../event.schema";

export const event = publicProcedure.input(ZEventInputSchema).query(async (opts) => {
  const session = await getSession(opts.ctx);
  const userId = session?.user?.id;
  const { default: handler } = await import("../event.handler");
  // TW-T9.2d: a logged-out request has no session org, so forced RLS on users/Team/EventType hid every
  // row and the booker showed 404. The username (team slug when isTeamEvent) resolves the org, as in
  // slots.getSchedule. Unresolved keeps the previous behaviour (session org, else no rows).
  const twOrgId = await resolvePublicTwOrg(
    opts.ctx.prisma,
    publicLookupForSchedule({ usernameList: [opts.input.username], isTeamEvent: opts.input.isTeamEvent })
  );
  if (twOrgId) return runWithTwOrg(twOrgId, () => handler({ input: opts.input, userId }));
  return handler({ input: opts.input, userId });
});
