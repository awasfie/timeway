import type { PrismaClient } from "@calcom/prisma";
import defaultPrisma from "@calcom/prisma";
import type { MembershipRole } from "@calcom/prisma/enums";

/**
 * Role-fallback permission check (t_082ff878, CC-13 class).
 *
 * Cal.diy removed the PBAC engine and left ~17 local `PermissionCheckService` stubs whose
 * checkPermission/hasPermission returned `true` for every call, so every authenticated user
 * passed every team/org permission check (cross-tenant). With PBAC gone, a permission is
 * decided only by the caller's `fallbackRoles`: the user needs an ACCEPTED membership with one
 * of those roles on the team itself, or on the team's parent organization. The `permission`
 * string is kept in the signature so call sites read the same as upstream, but it grants nothing.
 *
 * Fail closed: no fallbackRoles, no userId or no teamId means no permission.
 */
export type PermissionCheckInput = {
  userId: number;
  teamId: number | null | undefined;
  permission?: string;
  fallbackRoles: MembershipRole[] | readonly MembershipRole[];
};

export type TeamIdsWithPermissionInput = {
  userId: number;
  permission?: string;
  fallbackRoles: MembershipRole[] | readonly MembershipRole[];
  /** Accepted for upstream signature compatibility; scoping is by membership only. */
  orgId?: number;
};

type MembershipClient = Pick<PrismaClient, "membership" | "team">;

export class PermissionCheckService {
  private readonly prismaOverride?: MembershipClient;

  constructor(prisma?: MembershipClient | null) {
    this.prismaOverride = prisma ?? undefined;
  }

  private get prisma(): MembershipClient {
    return this.prismaOverride ?? defaultPrisma;
  }

  async checkPermission({ userId, teamId, fallbackRoles }: PermissionCheckInput): Promise<boolean> {
    if (!userId || !teamId || !fallbackRoles?.length) return false;
    const membership = await this.prisma.membership.findFirst({
      where: {
        userId,
        accepted: true,
        role: { in: [...fallbackRoles] },
        team: { OR: [{ id: teamId }, { children: { some: { id: teamId } } }] },
      },
      select: { id: true },
    });
    return !!membership;
  }

  /** Same rule as checkPermission; kept because some call sites use the upstream name. */
  async hasPermission(input: PermissionCheckInput): Promise<boolean> {
    return this.checkPermission(input);
  }

  /**
   * Team ids on which the user holds one of `fallbackRoles` (accepted), plus every child team of
   * an organization on which they hold such a role. Never includes teams of another tenant.
   */
  async getTeamIdsWithPermission({ userId, fallbackRoles }: TeamIdsWithPermissionInput): Promise<number[]> {
    if (!userId || !fallbackRoles?.length) return [];
    const memberships = await this.prisma.membership.findMany({
      where: { userId, accepted: true, role: { in: [...fallbackRoles] } },
      select: { teamId: true },
    });
    const direct = memberships.map((m) => m.teamId);
    if (!direct.length) return [];
    const children = await this.prisma.team.findMany({
      where: { parentId: { in: direct } },
      select: { id: true },
    });
    return Array.from(new Set([...direct, ...children.map((t) => t.id)]));
  }
}
