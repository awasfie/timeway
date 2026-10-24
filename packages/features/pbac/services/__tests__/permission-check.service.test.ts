import { describe, expect, it } from "vitest";

import { MembershipRole } from "@calcom/prisma/enums";

import { PermissionCheckService } from "../permission-check.service";
import { ORG_A, ORG_B, TEAM_A1, TEAM_B1, USERS, twoTenantPrisma } from "./fakeMembershipPrisma";

const ADMIN_ROLES = [MembershipRole.ADMIN, MembershipRole.OWNER];
const ALL_ROLES = [MembershipRole.MEMBER, MembershipRole.ADMIN, MembershipRole.OWNER];

function service() {
  return new PermissionCheckService(twoTenantPrisma() as never);
}

describe("PermissionCheckService role fallback (t_082ff878)", () => {
  it("refuses an org B owner on org A and on org A's team (cross-tenant)", async () => {
    const s = service();
    expect(await s.checkPermission({ userId: USERS.orgBOwner, teamId: ORG_A, fallbackRoles: ADMIN_ROLES })).toBe(false);
    expect(await s.checkPermission({ userId: USERS.orgBOwner, teamId: TEAM_A1, fallbackRoles: ALL_ROLES })).toBe(false);
    expect(await s.hasPermission({ userId: USERS.orgBOwner, teamId: TEAM_A1, fallbackRoles: ALL_ROLES })).toBe(false);
  });

  it("grants the org A owner on org A and its child team, never on org B", async () => {
    const s = service();
    expect(await s.checkPermission({ userId: USERS.orgAOwner, teamId: ORG_A, fallbackRoles: ADMIN_ROLES })).toBe(true);
    expect(await s.checkPermission({ userId: USERS.orgAOwner, teamId: TEAM_A1, fallbackRoles: ADMIN_ROLES })).toBe(true);
    expect(await s.checkPermission({ userId: USERS.orgAOwner, teamId: TEAM_B1, fallbackRoles: ADMIN_ROLES })).toBe(false);
  });

  it("a team admin does not inherit the parent org", async () => {
    const s = service();
    expect(await s.checkPermission({ userId: USERS.teamA1Admin, teamId: TEAM_A1, fallbackRoles: ADMIN_ROLES })).toBe(true);
    expect(await s.checkPermission({ userId: USERS.teamA1Admin, teamId: ORG_A, fallbackRoles: ADMIN_ROLES })).toBe(false);
  });

  it("checks the role: a MEMBER is refused admin permissions but allowed member ones", async () => {
    const s = service();
    expect(await s.checkPermission({ userId: USERS.teamA1Member, teamId: TEAM_A1, fallbackRoles: ADMIN_ROLES })).toBe(false);
    expect(await s.checkPermission({ userId: USERS.teamA1Member, teamId: TEAM_A1, fallbackRoles: ALL_ROLES })).toBe(true);
  });

  it("ignores memberships that are not accepted", async () => {
    const s = service();
    expect(await s.checkPermission({ userId: USERS.pendingOrgAAdmin, teamId: ORG_A, fallbackRoles: ADMIN_ROLES })).toBe(false);
  });

  it("fails closed without fallbackRoles, userId or teamId", async () => {
    const s = service();
    expect(await s.checkPermission({ userId: USERS.orgAOwner, teamId: ORG_A, fallbackRoles: [] })).toBe(false);
    expect(await s.checkPermission({ userId: USERS.orgAOwner, teamId: null, fallbackRoles: ADMIN_ROLES })).toBe(false);
    expect(await s.checkPermission({ userId: 0, teamId: ORG_A, fallbackRoles: ADMIN_ROLES })).toBe(false);
  });

  it("getTeamIdsWithPermission returns only the caller's own tenant teams", async () => {
    const s = service();
    expect((await s.getTeamIdsWithPermission({ userId: USERS.orgAOwner, fallbackRoles: ADMIN_ROLES })).sort()).toEqual([ORG_A, TEAM_A1]);
    expect((await s.getTeamIdsWithPermission({ userId: USERS.orgBOwner, fallbackRoles: ADMIN_ROLES })).sort()).toEqual([ORG_B, TEAM_B1]);
    expect(await s.getTeamIdsWithPermission({ userId: USERS.teamA1Member, fallbackRoles: ADMIN_ROLES })).toEqual([]);
    expect(await s.getTeamIdsWithPermission({ userId: USERS.pendingOrgAAdmin, fallbackRoles: ADMIN_ROLES })).toEqual([]);
    expect(await s.getTeamIdsWithPermission({ userId: USERS.orgAOwner, fallbackRoles: [] })).toEqual([]);
  });
});
