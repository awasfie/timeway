import { MembershipRole } from "@calcom/prisma/enums";
import { describe, expect, it } from "vitest";
import { RoleBasedPermissionCheckService } from "../RoleBasedPermissionCheckService";
import { ORG_A, ORG_B, TEAM_A1, TEAM_B1, twoTenantPrisma, USERS } from "./fakeMembershipPrisma";

const ADMINS = [MembershipRole.ADMIN, MembershipRole.OWNER];
const ALL = [MembershipRole.MEMBER, MembershipRole.ADMIN, MembershipRole.OWNER];

describe("RoleBasedPermissionCheckService (t_83304bed)", () => {
  const svc = new RoleBasedPermissionCheckService(twoTenantPrisma() as never);

  describe("checkPermission", () => {
    it("grants a team admin on the team and an org owner on the org's child team", async () => {
      expect(
        await svc.checkPermission({ userId: USERS.teamA1Admin, teamId: TEAM_A1, fallbackRoles: ADMINS })
      ).toBe(true);
      expect(
        await svc.checkPermission({ userId: USERS.orgAOwner, teamId: TEAM_A1, fallbackRoles: ADMINS })
      ).toBe(true);
      expect(
        await svc.checkPermission({ userId: USERS.orgAOwner, teamId: ORG_A, fallbackRoles: ADMINS })
      ).toBe(true);
    });

    it("denies another tenant's owner on org A and its teams", async () => {
      expect(await svc.checkPermission({ userId: USERS.orgBOwner, teamId: ORG_A, fallbackRoles: ALL })).toBe(
        false
      );
      expect(
        await svc.checkPermission({ userId: USERS.orgBOwner, teamId: TEAM_A1, fallbackRoles: ALL })
      ).toBe(false);
      expect(
        await svc.checkPermission({ userId: USERS.orgAOwner, teamId: TEAM_B1, fallbackRoles: ALL })
      ).toBe(false);
    });

    it("respects fallbackRoles: a member is denied an admin-only check but allowed a member one", async () => {
      expect(
        await svc.checkPermission({ userId: USERS.teamA1Member, teamId: TEAM_A1, fallbackRoles: ADMINS })
      ).toBe(false);
      expect(
        await svc.checkPermission({ userId: USERS.teamA1Member, teamId: TEAM_A1, fallbackRoles: ALL })
      ).toBe(true);
    });

    it("does not let a team admin climb to the parent org", async () => {
      expect(
        await svc.checkPermission({ userId: USERS.teamA1Admin, teamId: ORG_A, fallbackRoles: ADMINS })
      ).toBe(false);
    });

    it("denies a pending (not accepted) membership", async () => {
      expect(
        await svc.checkPermission({ userId: USERS.pendingOrgAAdmin, teamId: ORG_A, fallbackRoles: ADMINS })
      ).toBe(false);
    });

    it("fails closed on empty roles or a missing team id", async () => {
      expect(await svc.checkPermission({ userId: USERS.orgAOwner, teamId: ORG_A, fallbackRoles: [] })).toBe(
        false
      );
      expect(
        await svc.checkPermission({ userId: USERS.orgAOwner, teamId: null, fallbackRoles: ADMINS })
      ).toBe(false);
      expect(
        await svc.hasPermission({ userId: USERS.orgAOwner, teamId: undefined, fallbackRoles: ADMINS })
      ).toBe(false);
    });
  });

  describe("getTeamIdsWithPermission", () => {
    it("returns own teams plus child teams of orgs where the role is held", async () => {
      expect(
        (await svc.getTeamIdsWithPermission({ userId: USERS.orgAOwner, fallbackRoles: ADMINS })).sort()
      ).toEqual([ORG_A, TEAM_A1].sort());
      expect(
        await svc.getTeamIdsWithPermission({ userId: USERS.teamA1Admin, fallbackRoles: ADMINS })
      ).toEqual([TEAM_A1]);
    });

    it("never returns another tenant's teams, pending memberships or under-privileged roles", async () => {
      const b = await svc.getTeamIdsWithPermission({ userId: USERS.orgBOwner, fallbackRoles: ALL });
      expect(b.sort()).toEqual([ORG_B, TEAM_B1].sort());
      expect(b).not.toContain(ORG_A);
      expect(b).not.toContain(TEAM_A1);
      expect(
        await svc.getTeamIdsWithPermission({ userId: USERS.pendingOrgAAdmin, fallbackRoles: ADMINS })
      ).toEqual([]);
      expect(
        await svc.getTeamIdsWithPermission({ userId: USERS.teamA1Member, fallbackRoles: ADMINS })
      ).toEqual([]);
      expect(await svc.getTeamIdsWithPermission({ userId: USERS.orgAOwner, fallbackRoles: [] })).toEqual([]);
    });
  });
});
