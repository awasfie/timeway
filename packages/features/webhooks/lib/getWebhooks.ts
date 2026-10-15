import { withReporting } from "@calcom/lib/sentryWrapper";
import defaultPrisma from "@calcom/prisma";
import type { PrismaClient } from "@calcom/prisma";
import type { WebhookTriggerEvents } from "@calcom/prisma/enums";

import type { WebhookSubscriber } from "./dto/types";
import { WebhookOutputMapper } from "./infrastructure/mappers/WebhookOutputMapper";

export type GetSubscriberOptions = {
  userId?: number | null;
  eventTypeId?: number | null;
  triggerEvent: WebhookTriggerEvents;
  teamId?: number | number[] | null;
  orgId?: number | null;
  oAuthClientId?: string | null;
};

const getWebhooks = async (
  options: GetSubscriberOptions,
  prisma: PrismaClient = defaultPrisma
): Promise<WebhookSubscriber[]> => {
  const teamId = options.teamId;
  const userId = options.userId ?? 0;
  const eventTypeId = options.eventTypeId ?? 0;
  const teamIds = Array.isArray(teamId) ? teamId : [teamId ?? 0];
  const orgId = options.orgId ?? 0;
  const oAuthClientId = options.oAuthClientId ?? "";

  // Timeway (FIX-TW-AWS-2-WH): the Cal.diy refactor (ab21c7f805) made every booking
  // caller pass teamId/orgId as null, so team- and org-scoped webhooks never fired for
  // team event types. Derive the owning team (and its org) from the event type here,
  // once, so every caller (create, reschedule, cancel, confirm, request) is covered.
  const eventTypeScope = eventTypeId
    ? await prisma.eventType.findUnique({
        where: { id: eventTypeId },
        select: {
          parentId: true,
          teamId: true,
          team: { select: { parentId: true } },
          parent: { select: { teamId: true, team: { select: { parentId: true } } } },
        },
      })
    : null;

  const managedParentEventTypeId = eventTypeScope?.parentId ?? 0;
  const eventTypeTeamId = eventTypeScope?.teamId ?? eventTypeScope?.parent?.teamId ?? null;
  const eventTypeOrgId = eventTypeScope?.team?.parentId ?? eventTypeScope?.parent?.team?.parentId ?? null;
  const scopedTeamIds = [...teamIds, orgId];
  if (eventTypeTeamId) scopedTeamIds.push(eventTypeTeamId);
  if (eventTypeOrgId) scopedTeamIds.push(eventTypeOrgId);

  // if we have userId and teamId it is a managed event type and should trigger for team and user
  const allWebhooks = await prisma.webhook.findMany({
    where: {
      OR: [
        {
          platform: true,
        },
        {
          userId,
        },
        {
          eventTypeId,
        },
        {
          eventTypeId: managedParentEventTypeId,
        },
        {
          teamId: {
            in: scopedTeamIds,
          },
        },
        { platformOAuthClientId: oAuthClientId },
      ],
      AND: {
        eventTriggers: {
          has: options.triggerEvent,
        },
        active: {
          equals: true,
        },
      },
    },
    select: {
      id: true,
      subscriberUrl: true,
      payloadTemplate: true,
      appId: true,
      secret: true,
      time: true,
      timeUnit: true,
      eventTriggers: true,
      version: true,
    },
  });

  return allWebhooks.map(WebhookOutputMapper.toSubscriberPartial);
};

export default withReporting(getWebhooks, "getWebhooks");
