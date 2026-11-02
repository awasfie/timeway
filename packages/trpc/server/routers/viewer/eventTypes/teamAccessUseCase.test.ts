import { RoleBasedPermissionCheckService } from "@calcom/features/membership/services/RoleBasedPermissionCheckService";
import {
  ORG_A,
  TEAM_A1,
  TEAM_B1,
  twoTenantPrisma,
  USERS,
} from "@calcom/features/membership/services/__tests__/fakeMembershipPrisma";
import { describe, expect, it } from "vitest";
import { TeamAccessUseCase } from "./teamAccessUseCase";

const membership = (teamId: number, isOrganization = false) =>
  ({ teamId, team: { id: teamId, isOrganization } }) as never;

// t_83304bed: the stub let every listed membership through regardless of whose it was.
describe("TeamAccessUseCase (t_83304bed)", () => {
  const useCase = new TeamAccessUseCase(new RoleBasedPermissionCheckService(twoTenantPrisma() as never));

  it("drops teams the user has no accepted membership in", async () => {
    const out = await useCase.filterTeamsByEventTypeReadPermission(
      [membership(TEAM_A1), membership(TEAM_B1)],
      USERS.teamA1Member
    );
    expect(out.map((m: { teamId: number }) => m.teamId)).toEqual([TEAM_A1]);
  });

  it("drops another tenant's team and organization memberships", async () => {
    const out = await useCase.filterTeamsByEventTypeReadPermission(
      [membership(TEAM_A1), membership(ORG_A, true)],
      USERS.orgBOwner
    );
    expect(out).toEqual([]);
  });
});
