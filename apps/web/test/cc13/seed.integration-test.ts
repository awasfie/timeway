import { prisma } from "@calcom/prisma";
import { withTwPlatform } from "@calcom/prisma/tw-org-context";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Cc13Seed } from "./seed";
import { seedCc13Tenants } from "./seed";

let seed: Cc13Seed;

beforeAll(async () => {
  seed = await seedCc13Tenants();
});

afterAll(async () => {
  await seed?.cleanup();
});

describe("CC-13 seed (WC-TW-7a)", () => {
  it("seeds two disjoint tenants", async () => {
    const { A, B } = seed;
    expect(A.team.id).not.toBe(B.team.id);
    expect(A.twOrg.id).not.toBe(B.twOrg.id);

    for (const t of [A, B]) {
      const users = await prisma.user.findMany({
        where: { id: { in: [t.owner.id, t.member.id] } },
        select: { organizationId: true, twOrgId: true },
      });
      expect(users).toHaveLength(2);
      for (const u of users) expect(u).toEqual({ organizationId: t.team.id, twOrgId: t.twOrg.id });

      const [et, bk, sc, wh, ak] = await Promise.all([
        prisma.eventType.findUnique({
          where: { id: t.eventType.id },
          select: { teamId: true, twOrgId: true },
        }),
        prisma.booking.findUnique({ where: { id: t.booking.id }, select: { twOrgId: true } }),
        prisma.schedule.findUnique({ where: { id: t.schedule.id }, select: { twOrgId: true } }),
        prisma.webhook.findUnique({ where: { id: t.webhook.id }, select: { teamId: true } }),
        prisma.apiKey.findUnique({ where: { id: t.apiKey.id }, select: { teamId: true } }),
      ]);
      expect(et).toEqual({ teamId: t.team.id, twOrgId: t.twOrg.id });
      expect(bk).toEqual({ twOrgId: t.twOrg.id });
      expect(sc).toEqual({ twOrgId: t.twOrg.id });
      expect(wh).toEqual({ teamId: t.team.id });
      expect(ak).toEqual({ teamId: t.team.id });

      const members = await prisma.membership.count({ where: { teamId: t.team.id } });
      expect(members).toBe(2);
    }
  });

  it("seeds tw org members and org API keys per tenant", async () => {
    const { A, B } = seed;
    // Read under platform context: the CI role is a superuser (bypasses RLS) but a hardened DB role is not.
    const rows = await withTwPlatform(prisma, "CC-13 seed self-test", async (tx) => ({
      members: await tx.organizationMember.findMany({
        where: { orgId: { in: [A.twOrg.id, B.twOrg.id] } },
        select: { orgId: true, userId: true, role: true },
        orderBy: { userId: "asc" },
      }),
      keys: await tx.orgApiKey.findMany({
        where: { id: { in: [A.orgApiKey.id, B.orgApiKey.id] } },
        select: { orgId: true, prefix: true },
      }),
    }));
    expect(rows.members).toEqual([
      { orgId: A.twOrg.id, userId: A.owner.id, role: "owner" },
      { orgId: A.twOrg.id, userId: A.member.id, role: "member" },
      { orgId: B.twOrg.id, userId: B.owner.id, role: "owner" },
      { orgId: B.twOrg.id, userId: B.member.id, role: "member" },
    ]);
    expect(rows.keys).toHaveLength(2);
    expect(new Set(rows.keys.map((k) => k.orgId))).toEqual(new Set([A.twOrg.id, B.twOrg.id]));
    expect(A.orgApiKey.raw.startsWith(`${A.orgApiKey.prefix}.`)).toBe(true);
  });
});
