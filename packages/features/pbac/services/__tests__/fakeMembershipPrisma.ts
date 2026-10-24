import type { MembershipRole } from "@calcom/prisma/enums";

/**
 * In-memory membership/team model for cross-tenant tests (t_082ff878). Implements only the
 * where-shapes PermissionCheckService issues, so a test exercises the real rule, not a mock answer.
 */
export type FakeTeam = { id: number; parentId: number | null };
export type FakeMembership = { id: number; userId: number; teamId: number; role: MembershipRole; accepted: boolean };

type MembershipWhere = {
  userId?: number;
  accepted?: boolean;
  role?: { in: MembershipRole[] };
  teamId?: { in: number[] };
  team?: { OR: [{ id: number }, { children: { some: { id: number } } }] };
};

export function createFakeMembershipPrisma(teams: FakeTeam[], memberships: FakeMembership[]) {
  const match = (m: FakeMembership, where: MembershipWhere) => {
    if (where.userId !== undefined && m.userId !== where.userId) return false;
    if (where.accepted !== undefined && m.accepted !== where.accepted) return false;
    if (where.role && !where.role.in.includes(m.role)) return false;
    if (where.teamId && !where.teamId.in.includes(m.teamId)) return false;
    if (where.team) {
      const target = where.team.OR[0].id;
      const childId = where.team.OR[1].children.some.id;
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
        return m ? { id: m.id, teamId: m.teamId } : null;
      },
      findMany: async ({ where }: { where: MembershipWhere }) =>
        memberships.filter((x) => match(x, where)).map((m) => ({ id: m.id, teamId: m.teamId })),
    },
    team: {
      findMany: async ({ where }: { where: { parentId: { in: number[] } } }) =>
        teams.filter((t) => t.parentId !== null && where.parentId.in.includes(t.parentId)).map((t) => ({ id: t.id })),
    },
  };
}

/**
 * Two tenants: org A (id 1) with team A1 (id 11); org B (id 2) with team B1 (id 21).
 * User 100 = org A owner, user 101 = team A1 admin, user 102 = team A1 member,
 * user 200 = org B owner, user 201 = invited (not accepted) admin of org A.
 */
export const ORG_A = 1;
export const TEAM_A1 = 11;
export const ORG_B = 2;
export const TEAM_B1 = 21;
export const USERS = { orgAOwner: 100, teamA1Admin: 101, teamA1Member: 102, orgBOwner: 200, pendingOrgAAdmin: 201 };

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
      { id: 5, userId: USERS.pendingOrgAAdmin, teamId: ORG_A, role: "ADMIN" as MembershipRole, accepted: false },
    ]
  );
}
