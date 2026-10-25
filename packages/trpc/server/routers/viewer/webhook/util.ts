import { RoleBasedPermissionCheckService } from "@calcom/features/membership/services/RoleBasedPermissionCheckService";
import { prisma } from "@calcom/prisma";
import { MembershipRole } from "@calcom/prisma/enums";

import { TRPCError } from "@trpc/server";

import authedProcedure from "../../../procedures/authedProcedure";
import { webhookIdAndEventTypeIdSchema } from "./types";

export const createWebhookProcedure = () => {
  return authedProcedure.input(webhookIdAndEventTypeIdSchema.optional()).use(async ({ ctx, input, next, type }) => {
    if (!input) return next();

    const { id, webhookId, eventTypeId, teamId } = input;
    const lookupId = id || webhookId;
    // Team webhooks carry a signing secret: members may read, only admins/owners may change.
    const teamRoles =
      type === "query"
        ? [MembershipRole.MEMBER, MembershipRole.ADMIN, MembershipRole.OWNER]
        : [MembershipRole.ADMIN, MembershipRole.OWNER];
    const assertTeamAccess = async (forTeamId: number) => {
      const allowed = await new RoleBasedPermissionCheckService(prisma).checkPermission({
        userId: ctx.user.id,
        teamId: forTeamId,
        fallbackRoles: teamRoles,
      });
      if (!allowed) throw new TRPCError({ code: "FORBIDDEN" });
    };

    if (teamId) await assertTeamAccess(teamId);

    if (lookupId) {
      // Check if user is authorized to edit webhook
      const webhook = await prisma.webhook.findUnique({
        where: { id: lookupId },
        select: {
          id: true,
          userId: true,
          teamId: true,
          eventTypeId: true,
          platform: true,
        },
      });

      if (!webhook) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (eventTypeId && eventTypeId !== webhook.eventTypeId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }

      if (webhook.eventTypeId) {
        const eventType = await prisma.eventType.findUnique({
          where: { id: webhook.eventTypeId },
          select: { id: true, userId: true },
        });

        if (!eventType) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }

        if (eventType.userId !== ctx.user.id) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
      } else if (webhook.teamId) {
        await assertTeamAccess(webhook.teamId);
      } else if (webhook.userId) {
        if (webhook.userId !== ctx.user.id) throw new TRPCError({ code: "FORBIDDEN" });
      } else if (webhook.platform) {
        if (ctx.user.role !== "ADMIN") throw new TRPCError({ code: "FORBIDDEN" });
      } else {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
    } else if (eventTypeId) {
      const eventType = await prisma.eventType.findUnique({
        where: { id: eventTypeId },
        select: { id: true, userId: true },
      });

      if (!eventType) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (eventType.userId !== ctx.user.id) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
    }

    return next();
  });
};

export const webhookProcedure = createWebhookProcedure();
