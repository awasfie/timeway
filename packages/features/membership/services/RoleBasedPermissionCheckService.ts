import type { PrismaClient } from "@calcom/prisma";
import { prisma as defaultPrisma } from "@calcom/prisma";
import type { MembershipRole } from "@calcom/prisma/enums";

type CheckPermissionInput = {
  userId: number;
  teamId: number;
  /** PBAC permission name, kept for call-site parity; Cal.diy has no PBAC, so only fallbackRoles decide. */
  permission?: string;
  fallbackRoles: MembershipRole[];
};

/**
 * Stand-in for upstream's PBAC PermissionCheckService. The Cal.diy refactor replaced it with stubs that
 * returned true for every check, which let any signed-in user act on any team's data (CC-13 probes,
 * WC-TW-7b). This version enforces the fallback roles: an accepted membership in the team, or in the
 * team's parent organization, with one of the given roles.
 */
export class RoleBasedPermissionCheckService {
  constructor(private readonly prismaClient: PrismaClient = defaultPrisma) {}

  async checkPermission({ userId, teamId, fallbackRoles }: CheckPermissionInput): Promise<boolean> {
    if (!fallbackRoles.length) return false;
    const membership = await this.prismaClient.membership.findFirst({
      where: {
        userId,
        accepted: true,
        role: { in: fallbackRoles },
        OR: [{ teamId }, { team: { children: { some: { id: teamId } } } }],
      },
      select: { id: true },
    });
    return !!membership;
  }

  async hasPermission(input: CheckPermissionInput): Promise<boolean> {
    return this.checkPermission(input);
  }

  async getTeamIdsWithPermission({
    userId,
    fallbackRoles,
  }: {
    userId: number;
    permission?: string;
    fallbackRoles: MembershipRole[];
  }): Promise<number[]> {
    if (!fallbackRoles.length) return [];
    const memberships = await this.prismaClient.membership.findMany({
      where: { userId, accepted: true, role: { in: fallbackRoles } },
      select: { teamId: true, team: { select: { children: { select: { id: true } } } } },
    });
    const ids = new Set<number>();
    for (const m of memberships) {
      ids.add(m.teamId);
      for (const child of m.team.children) ids.add(child.id);
    }
    return [...ids];
  }
}
