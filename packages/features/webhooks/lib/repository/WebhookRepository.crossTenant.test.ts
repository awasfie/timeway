import { describe, expect, it, vi } from "vitest";

import { ORG_B, TEAM_A1, USERS, twoTenantPrisma } from "@calcom/features/pbac/services/__tests__/fakeMembershipPrisma";

import { WebhookRepository } from "./WebhookRepository";

// t_082ff878: listWebhooks widened to every team id the stub approved; now ADMIN/OWNER role fallback.
function repoFor(teamIds: number[]) {
  const findMany = vi.fn().mockResolvedValue([]);
  const prisma = { ...twoTenantPrisma(), webhook: { findMany } };
  const userRepository = { findUserTeams: vi.fn().mockResolvedValue({ teams: teamIds.map((teamId) => ({ teamId })) }) };
  const repo = new WebhookRepository(prisma as never, {} as never, userRepository as never);
  return { repo, findMany };
}

/** Team ids the query widens to (the `{ teamId: { in } }` branch of the user/team OR). */
function teamFilter(findMany: ReturnType<typeof vi.fn>): number[] {
  const and = findMany.mock.calls[0][0].where.AND as Array<{ OR?: Array<{ teamId?: { in: number[] } }> }>;
  const or = and.find((c) => c.OR)?.OR ?? [];
  return or.flatMap((c) => c.teamId?.in ?? []);
}

describe("WebhookRepository.listWebhooks cross-tenant (t_082ff878)", () => {
  it("does not expose team A1 webhooks to a plain member of team A1", async () => {
    const { repo, findMany } = repoFor([TEAM_A1]);
    await repo.listWebhooks({ userId: USERS.teamA1Member });
    expect(teamFilter(findMany)).toEqual([]);
  });

  it("does not expose team A1 webhooks to an org B owner even if a team id is passed through", async () => {
    const { repo, findMany } = repoFor([TEAM_A1, ORG_B]);
    await repo.listWebhooks({ userId: USERS.orgBOwner });
    const filter = teamFilter(findMany);
    expect(filter).toEqual([ORG_B]);
  });

  it("includes team A1 for its admin", async () => {
    const { repo, findMany } = repoFor([TEAM_A1]);
    await repo.listWebhooks({ userId: USERS.teamA1Admin });
    expect(teamFilter(findMany)).toEqual([TEAM_A1]);
  });
});
