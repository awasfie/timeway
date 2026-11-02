import { describe, expect, it, vi } from "vitest";

vi.mock("@calcom/prisma", async () => {
  const { twoTenantPrisma } = await import(
    "@calcom/features/membership/services/__tests__/fakeMembershipPrisma"
  );
  const fake = twoTenantPrisma();
  return { default: fake, prisma: fake };
});

import { USERS } from "@calcom/features/membership/services/__tests__/fakeMembershipPrisma";
import { isAdminForUser } from "./outOfOffice.utils";

// t_83304bed: OOO admin rights came from getTeamIdsWithPermission, stubbed to [] (always denied).
describe("isAdminForUser (t_83304bed)", () => {
  it("refuses an org B owner acting on an org A member", async () => {
    expect(await isAdminForUser(USERS.orgBOwner, USERS.teamA1Member)).toBe(false);
  });

  it("refuses a plain member acting on a teammate", async () => {
    expect(await isAdminForUser(USERS.teamA1Member, USERS.teamA1Admin)).toBe(false);
  });

  it("grants the org A owner and the team A1 admin over a team A1 member", async () => {
    expect(await isAdminForUser(USERS.orgAOwner, USERS.teamA1Member)).toBe(true);
    expect(await isAdminForUser(USERS.teamA1Admin, USERS.teamA1Member)).toBe(true);
  });
});
