import {
  ORG_A,
  twoTenantPrisma,
  USERS,
} from "@calcom/features/membership/services/__tests__/fakeMembershipPrisma";
import { RoleBasedPermissionCheckService } from "@calcom/features/membership/services/RoleBasedPermissionCheckService";
import { describe, expect, it, vi } from "vitest";
import { OrganizationWatchlistOperationsService } from "./OrganizationWatchlistOperationsService";
import { OrganizationWatchlistQueryService } from "./OrganizationWatchlistQueryService";

// t_83304bed: the local stub returned true, so any user could read/write any org's watchlist.
describe("Organization watchlist cross-tenant (t_83304bed)", () => {
  const permissionCheckService = new RoleBasedPermissionCheckService(twoTenantPrisma() as never);
  const querySvc = (watchlistRepo: unknown) =>
    new OrganizationWatchlistQueryService({
      watchlistRepo: watchlistRepo as never,
      userRepo: { findUsersByIds: vi.fn().mockResolvedValue([]) } as never,
      permissionCheckService,
    } as never);

  it("refuses an org B owner listing org A's watchlist", async () => {
    const watchlistRepo = { findOrgAndGlobalEntries: vi.fn().mockResolvedValue({ rows: [], count: 0 }) };
    await expect(
      querySvc(watchlistRepo).listWatchlistEntries({
        organizationId: ORG_A,
        userId: USERS.orgBOwner,
        limit: 10,
        offset: 0,
      } as never)
    ).rejects.toThrow();
    expect(watchlistRepo.findOrgAndGlobalEntries).not.toHaveBeenCalled();
  });

  it("refuses an org B owner creating and deleting entries in org A", async () => {
    const watchlistRepo = {
      createEntry: vi.fn(),
      deleteEntry: vi.fn(),
      findEntryWithAuditAndReports: vi.fn(),
    };
    const svc = new OrganizationWatchlistOperationsService({
      watchlistRepo: watchlistRepo as never,
      bookingReportRepo: {} as never,
      permissionCheckService,
      organizationId: ORG_A,
    } as never);
    await expect(
      svc.createWatchlistEntry({ userId: USERS.orgBOwner, type: "EMAIL", value: "x@example.com" } as never)
    ).rejects.toThrow();
    await expect(
      svc.deleteWatchlistEntry({ userId: USERS.orgBOwner, entryId: "e1" } as never)
    ).rejects.toThrow();
    expect(watchlistRepo.createEntry).not.toHaveBeenCalled();
    expect(watchlistRepo.deleteEntry).not.toHaveBeenCalled();
  });

  it("lets the org A owner past the permission gate", async () => {
    const watchlistRepo = { findOrgAndGlobalEntries: vi.fn().mockResolvedValue({ rows: [], count: 0 }) };
    await querySvc(watchlistRepo).listWatchlistEntries({
      organizationId: ORG_A,
      userId: USERS.orgAOwner,
      limit: 10,
      offset: 0,
    } as never);
    expect(watchlistRepo.findOrgAndGlobalEntries).toHaveBeenCalled();
  });
});
