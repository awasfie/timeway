import { describe, expect, it, vi } from "vitest";

vi.mock("@calcom/prisma", async () => {
  const { twoTenantPrisma } = await import(
    "@calcom/features/membership/services/__tests__/fakeMembershipPrisma"
  );
  const fake = twoTenantPrisma();
  return { default: fake, prisma: fake };
});

// isAuthed resolves the session from ctx; the test injects the user directly.
vi.mock("../middlewares/sessionMiddleware", async () => {
  const { middleware } = await import("../trpc");
  const passthrough = middleware(({ ctx, next }) => next({ ctx }));
  return { isAuthed: passthrough, isAdminMiddleware: passthrough, isOrgAdminMiddleware: passthrough };
});

import { ORG_A, ORG_B, TEAM_A1, USERS } from "@calcom/features/membership/services/__tests__/fakeMembershipPrisma";
import { router } from "../trpc";
import { createOrgPbacProcedure, createTeamPbacProcedure } from "./pbacProcedures";

const appRouter = router({
  teamUpdate: createTeamPbacProcedure("team.update").mutation(() => "ok"),
  teamRead: createTeamPbacProcedure("team.read", ["MEMBER", "ADMIN", "OWNER"]).query(() => "ok"),
  orgUpdate: createOrgPbacProcedure("organization.update").mutation(({ ctx }) => ctx.organizationId),
});

const callerFor = (userId: number, organizationId: number | null = null) =>
  appRouter.createCaller({ user: { id: userId, organizationId }, session: {} } as never);

// t_83304bed: createTeamPbacProcedure / createOrgPbacProcedure used an always-true stub.
describe("pbacProcedures (t_83304bed)", () => {
  it("denies another tenant's owner on a team procedure", async () => {
    await expect(callerFor(USERS.orgBOwner).teamUpdate({ teamId: TEAM_A1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(callerFor(USERS.orgBOwner).teamRead({ teamId: ORG_A })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("denies a member on an admin-only team procedure but allows member-level reads", async () => {
    await expect(callerFor(USERS.teamA1Member).teamUpdate({ teamId: TEAM_A1 })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(callerFor(USERS.teamA1Member).teamRead({ teamId: TEAM_A1 })).resolves.toBe("ok");
  });

  it("denies a pending membership", async () => {
    await expect(callerFor(USERS.pendingOrgAAdmin).teamUpdate({ teamId: ORG_A })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("allows the team admin and the parent-org owner", async () => {
    await expect(callerFor(USERS.teamA1Admin).teamUpdate({ teamId: TEAM_A1 })).resolves.toBe("ok");
    await expect(callerFor(USERS.orgAOwner).teamUpdate({ teamId: TEAM_A1 })).resolves.toBe("ok");
  });

  it("org procedure: denies a non-admin of the caller's org and allows its owner", async () => {
    await expect(callerFor(USERS.teamA1Admin, ORG_A).orgUpdate()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerFor(USERS.orgBOwner, ORG_A).orgUpdate()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerFor(USERS.orgAOwner, ORG_A).orgUpdate()).resolves.toBe(ORG_A);
    await expect(callerFor(USERS.orgBOwner, ORG_B).orgUpdate()).resolves.toBe(ORG_B);
  });
});
