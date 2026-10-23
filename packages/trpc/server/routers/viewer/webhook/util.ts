import { prisma } from "@calcom/prisma";
import type { MembershipRole as MembershipRoleType } from "@calcom/prisma/enums";
import { MembershipRole, UserPermissionRole } from "@calcom/prisma/enums";
import { TRPCError } from "@trpc/server";
import authedProcedure from "../../../procedures/authedProcedure";
import { webhookIdAndEventTypeIdSchema } from "./types";

// PBAC is stubbed in this fork, so team webhooks use the upstream fallback roles directly:
// webhook.read = any accepted member, webhook.create/update/delete = ADMIN or OWNER (CC13-WH-001/002).
const READ_ROLES: MembershipRoleType[] = [MembershipRole.MEMBER, MembershipRole.ADMIN, MembershipRole.OWNER];
const WRITE_ROLES: MembershipRoleType[] = [MembershipRole.ADMIN, MembershipRole.OWNER];

const assertTeamWebhookAccess = async ({
  userId,
  teamId,
  write,
}: {
  userId: number;
  teamId: number;
  write: boolean;
}) => {
  const membership = await prisma.membership.findUnique({
    where: { userId_teamId: { userId, teamId } },
    select: { accepted: true, role: true },
  });

  const allowed = write ? WRITE_ROLES : READ_ROLES;
  if (!membership || !membership.accepted || !allowed.includes(membership.role)) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
};

const assertEventTypeOwner = async ({ userId, eventTypeId }: { userId: number; eventTypeId: number }) => {
  const eventType = await prisma.eventType.findUnique({
    where: { id: eventTypeId },
    select: { id: true, userId: true },
  });

  if (!eventType) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  if (eventType.userId !== userId) {
    throw new TRPCError({ code: "FORBIDDEN" });
  }
};

export const createWebhookProcedure = () => {
  return authedProcedure
    .input(webhookIdAndEventTypeIdSchema.optional())
    .use(async ({ ctx, input, next, type }) => {
      if (!input) return next();

      const { id, webhookId, eventTypeId, teamId } = input;
      const lookupId = id || webhookId;
      const write = type === "mutation";

      if (lookupId) {
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

        // Scope hints must match the row; edit spreads them into the update, so a mismatch would move the webhook.
        if (eventTypeId && eventTypeId !== webhook.eventTypeId) {
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }
        if (teamId && teamId !== webhook.teamId) {
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }

        if (webhook.eventTypeId) {
          await assertEventTypeOwner({ userId: ctx.user.id, eventTypeId: webhook.eventTypeId });
        } else if (webhook.teamId) {
          await assertTeamWebhookAccess({ userId: ctx.user.id, teamId: webhook.teamId, write });
        } else if (webhook.userId) {
          if (webhook.userId !== ctx.user.id) {
            throw new TRPCError({ code: "FORBIDDEN" });
          }
        } else if (webhook.platform) {
          if (ctx.user.role !== UserPermissionRole.ADMIN) {
            throw new TRPCError({ code: "FORBIDDEN" });
          }
        } else {
          // A row with no owner at all fails closed.
          throw new TRPCError({ code: "FORBIDDEN" });
        }
      } else {
        if (eventTypeId) {
          await assertEventTypeOwner({ userId: ctx.user.id, eventTypeId });
        }
        if (teamId) {
          await assertTeamWebhookAccess({ userId: ctx.user.id, teamId, write });
        }
      }

      return next();
    });
};

export const webhookProcedure = createWebhookProcedure();
