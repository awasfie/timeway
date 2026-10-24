import { MembershipRole } from "@calcom/prisma/enums";

export interface TeamPermissions {
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canRead: boolean;
}

export interface MembershipWithRole {
  teamId: number;
  membershipRole: MembershipRole;
}

const MEMBERSHIP_HIERARCHY: Record<MembershipRole, number> = {
  [MembershipRole.MEMBER]: 1,
  [MembershipRole.ADMIN]: 2,
  [MembershipRole.OWNER]: 3,
};

export function hasHigherPrivilege(role1: MembershipRole, role2: MembershipRole): boolean {
  return MEMBERSHIP_HIERARCHY[role1] > MEMBERSHIP_HIERARCHY[role2];
}

export function getEffectiveRole(
  orgMembership: MembershipRole | undefined,
  membershipRole: MembershipRole
): MembershipRole {
  return orgMembership && hasHigherPrivilege(orgMembership, membershipRole) ? orgMembership : membershipRole;
}

// t_082ff878: the PBAC engine is gone and the old local getResourcePermissions stub granted every
// permission to every role; event-type permissions now come from the effective membership role only.
export async function getTeamPermissions(
  _userId: number,
  _teamId: number,
  effectiveRole: MembershipRole
): Promise<TeamPermissions> {
  return getFallbackPermissions(effectiveRole);
}

function getFallbackPermissions(role: MembershipRole): TeamPermissions {
  const isAdminOrOwner = role === MembershipRole.ADMIN || role === MembershipRole.OWNER;
  const isMember = role === MembershipRole.MEMBER;

  return {
    canRead: isAdminOrOwner || isMember,
    canCreate: isAdminOrOwner,
    canEdit: isAdminOrOwner,
    canDelete: isAdminOrOwner,
  };
}

export async function buildTeamPermissionsMap(
  memberships: Array<{ team: { id: number; parentId?: number | null }; role: MembershipRole }>,
  teamMemberships: MembershipWithRole[],
  userId: number
): Promise<Map<number, TeamPermissions>> {
  const permissionPromises = memberships.map(async (membership) => {
    const orgMembership = teamMemberships.find(
      (teamM) => teamM.teamId === membership.team.parentId
    )?.membershipRole;

    const effectiveRole = getEffectiveRole(orgMembership, membership.role);
    const permissions = await getTeamPermissions(userId, membership.team.id, effectiveRole);

    return [membership.team.id, permissions] as const;
  });

  const results = await Promise.all(permissionPromises);
  return new Map(results);
}
