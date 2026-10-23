import logger from "@calcom/lib/logger";
import { safeStringify } from "@calcom/lib/safeStringify";
import type { PrismaClient } from "@calcom/prisma";

const log = logger.getSubLogger({ prefix: ["filterHostsToTeamMembers"] });

type TeamRef = { id: number; parentId?: number | null } | null | undefined;

/**
 * CC13-D1: read-side guard for team event hosts.
 *
 * The write path (eventTypes update.handler) refuses hosts that are not accepted members of the team.
 * A Host row can still exist without going through it (restored backup, direct SQL, a membership revoked
 * after assignment). Slot and booking assignment must never pick such a host, so every reader that turns
 * Host rows into bookable users drops hosts whose user holds no accepted membership in the event type's
 * team. For a sub-team (team.parentId set, which the write path exempts) an accepted membership in the
 * parent organization also qualifies. Events without a team (personal, managed children) are untouched.
 */
export async function filterHostsToTeamMembers<H extends { user: { id: number } }>({
  prismaClient,
  team,
  hosts,
  eventTypeId,
}: {
  prismaClient: Pick<PrismaClient, "membership">;
  team: TeamRef;
  hosts: H[];
  eventTypeId?: number;
}): Promise<H[]> {
  if (!team || hosts.length === 0) return hosts;

  const teamIds = team.parentId ? [team.id, team.parentId] : [team.id];
  const hostUserIds = Array.from(new Set(hosts.map((host) => host.user.id)));

  const memberships = await prismaClient.membership.findMany({
    where: { teamId: { in: teamIds }, accepted: true, userId: { in: hostUserIds } },
    select: { userId: true },
  });
  const memberIds = new Set(memberships.map((membership) => membership.userId));

  const kept = hosts.filter((host) => memberIds.has(host.user.id));
  if (kept.length !== hosts.length) {
    log.warn(
      "Dropped hosts without an accepted team membership",
      safeStringify({
        eventTypeId,
        teamId: team.id,
        droppedUserIds: hosts.filter((host) => !memberIds.has(host.user.id)).map((host) => host.user.id),
      })
    );
  }
  return kept;
}
