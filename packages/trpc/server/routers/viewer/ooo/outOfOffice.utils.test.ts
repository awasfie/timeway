import { describe, expect, it, vi } from "vitest";

import { USERS, twoTenantPrisma } from "@calcom/features/pbac/services/__tests__/fakeMembershipPrisma";

vi.mock("@calcom/prisma", async () => {
  const { twoTenantPrisma: build } = await import("@calcom/features/pbac/services/__tests__/fakeMembershipPrisma");
  const fake = build();
  return { default: fake, prisma: fake };
});

import { isAdminForUser } from "./outOfOffice.utils";

// t_082ff878: OOO admin rights (create/delete OOO for another user) came from a stub; now role fallback.
describe("isAdminForUser cross-tenant (t_082ff878)", () => {
  it("refuses an org B owner acting on an org A member", async () => {
    void twoTenantPrisma;
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
