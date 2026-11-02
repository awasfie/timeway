import type { MembershipRole } from "@calcom/prisma/enums";

/**
 * In-memory team/membership model for cross-tenant unit tests (t_83304bed). It implements only the
 * where/select shapes RoleBasedPermissionCheckService issues, so a test exercises the real rule
 * instead of a canned mock answer.
 */
export type FakeTeam = { id: number; parentId: number | null };
export type FakeMembership = {
  id: number;
  userId: number;
  teamId: number;
  role: MembershipRole;
  accepted: boolean;
};

type MembershipWhere = {
  userId?: number;
  accepted?: boolean;
  role?: { in: MembershipRole[] };
  teamId?: { in: number[] };
  OR?: [{ teamId: number }, { team: { children: { some: { id: number } } } }];
};

export function createFakeMembershipPrisma(teams: FakeTeam[], memberships: FakeMembership[]) {
  const childrenOf = (teamId: number) => teams.filter((t) => t.parentId === teamId).map((t) => ({ id: t.id }));
  const match = (m: FakeMembership, where: MembershipWhere) => {
    if (where.userId !== undefined && m.userId !== where.userId) return false;
    if (where.accepted !== undefined && m.accepted !== where.accepted) return false;
    if (where.role && !where.role.in.includes(m.role)) return false;
    if (where.teamId && !where.teamId.in.includes(m.teamId)) return false;
    if (where.OR) {
      const target = where.OR[0].teamId;
      const childId = where.OR[1].team.children.some.id;
      const isTeam = m.teamId === target;
      const isParentOf = teams.some((t) => t.id === childId && t.parentId === m.teamId);
      if (!isTeam && !isParentOf) return false;
    }
    return true;
  };
  return {
    membership: {
      findFirst: async ({ where }: { where: MembershipWhere }) => {
        const m = memberships.find((x) => match(x, where));
        return m ? { id: m.id } : null;
      },
      findMany: async ({ where }: { where: MembershipWhere }) =>
        memberships
          .filter((x) => match(x, where))
          .map((m) => ({ teamId: m.teamId, team: { children: childrenOf(m.teamId) } })),
    },
  };
}

/**
 * Two tenants: org A (id 1) with team A1 (id 11); org B (id 2) with team B1 (id 21).
 * 100 = org A owner, 101 = team A1 admin, 102 = team A1 member, 200 = org B owner,
 * 201 = invited (not accepted) admin of org A.
 */
export const ORG_A = 1;
export const TEAM_A1 = 11;
export const ORG_B = 2;
export const TEAM_B1 = 21;
export const USERS = {
  orgAOwner: 100,
  teamA1Admin: 101,
  teamA1Member: 102,
  orgBOwner: 200,
  pendingOrgAAdmin: 201,
} as const;

export function twoTenantPrisma() {
  return createFakeMembershipPrisma(
    [
      { id: ORG_A, parentId: null },
      { id: TEAM_A1, parentId: ORG_A },
      { id: ORG_B, parentId: null },
      { id: TEAM_B1, parentId: ORG_B },
    ],
    [
      { id: 1, userId: USERS.orgAOwner, teamId: ORG_A, role: "OWNER" as MembershipRole, accepted: true },
      { id: 2, userId: USERS.teamA1Admin, teamId: TEAM_A1, role: "ADMIN" as MembershipRole, accepted: true },
      { id: 3, userId: USERS.teamA1Member, teamId: TEAM_A1, role: "MEMBER" as MembershipRole, accepted: true },
      { id: 4, userId: USERS.orgBOwner, teamId: ORG_B, role: "OWNER" as MembershipRole, accepted: true },
      {
        id: 5,
        userId: USERS.pendingOrgAAdmin,
        teamId: ORG_A,
        role: "ADMIN" as MembershipRole,
        accepted: false,
      },
    ]
  );
}
