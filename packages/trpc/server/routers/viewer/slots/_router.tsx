import {
  publicLookupForEventTypeIds,
  publicLookupForSchedule,
  resolvePublicTwOrg,
} from "@calcom/lib/server/tw-org-scope/public";
import { runWithTwOrg } from "@calcom/prisma/tw-org-context";
import { TRPCError } from "@trpc/server";
import type { NextApiRequest, NextApiResponse } from "next";
import publicProcedure from "../../../procedures/publicProcedure";
import { router } from "../../../trpc";
import { ZIsAvailableInputSchema, ZIsAvailableOutputSchema } from "./isAvailable.schema";
import { ZRemoveSelectedSlotInputSchema } from "./removeSelectedSlot.schema";
import { ZReserveSlotInputSchema } from "./reserveSlot.schema";
import { ZGetScheduleInputSchema } from "./types";

type SlotsRouterHandlerCache = {
  getSchedule?: typeof import("./getSchedule.handler").getScheduleHandler;
  reserveSlot?: typeof import("./reserveSlot.handler").reserveSlotHandler;
  isAvailable?: typeof import("./isAvailable.handler").isAvailableHandler;
};

/** This should be called getAvailableSlots */
export const slotsRouter = router({
  getSchedule: publicProcedure.input(ZGetScheduleInputSchema).query(async ({ input, ctx }) => {
    const { getScheduleHandler } = await import("./getSchedule.handler");

    // TW-T9.2b2: usernameList (team slug when isTeamEvent) resolves the org; orgSlug is ignored.
    const twOrgId = await resolvePublicTwOrg(ctx.prisma, publicLookupForSchedule(input));
    if (!twOrgId) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

    return runWithTwOrg(twOrgId, () =>
      getScheduleHandler({
        ctx,
        input,
      })
    );
  }),
  reserveSlot: publicProcedure.input(ZReserveSlotInputSchema).mutation(async ({ input, ctx }) => {
    const { reserveSlotHandler } = await import("./reserveSlot.handler");

    // TW-T9.2b2f: the org is that of the event type being reserved.
    const twOrgId = await resolvePublicTwOrg(ctx.prisma, publicLookupForEventTypeIds([input.eventTypeId]));
    if (!twOrgId) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

    return runWithTwOrg(twOrgId, () =>
      reserveSlotHandler({
        ctx: { ...ctx, req: ctx.req as NextApiRequest, res: ctx.res as NextApiResponse },
        input,
      })
    );
  }),
  isAvailable: publicProcedure
    .input(ZIsAvailableInputSchema)
    .output(ZIsAvailableOutputSchema)
    .query(async ({ input, ctx }) => {
      const { isAvailableHandler } = await import("./isAvailable.handler");

      const twOrgId = await resolvePublicTwOrg(ctx.prisma, publicLookupForEventTypeIds([input.eventTypeId]));
      if (!twOrgId) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });

      return runWithTwOrg(twOrgId, () =>
        isAvailableHandler({
          ctx: { ...ctx, req: ctx.req as NextApiRequest },
          input,
        })
      );
    }),
  // This endpoint has no dependencies, it doesn't need its own file
  removeSelectedSlotMark: publicProcedure
    .input(ZRemoveSelectedSlotInputSchema)
    .mutation(async ({ input, ctx }) => {
      const { req, prisma } = ctx;
      const uid = req?.cookies?.uid || input.uid;
      if (!uid) return;
      // The reservation uid names no org; its rows' event types do. No rows means there
      // is nothing to release (the booker calls this on every unmount), so no 404 then.
      const marks = await prisma.selectedSlots.findMany({
        where: { uid: { equals: uid } },
        select: { eventTypeId: true },
        distinct: ["eventTypeId"],
      });
      if (marks.length === 0) return;
      const twOrgId = await resolvePublicTwOrg(
        prisma,
        publicLookupForEventTypeIds(marks.map((m) => m.eventTypeId))
      );
      if (!twOrgId) throw new TRPCError({ code: "NOT_FOUND", message: "Not found" });
      await runWithTwOrg(twOrgId, () => prisma.selectedSlots.deleteMany({ where: { uid: { equals: uid } } }));
      return;
    }),
});
