import type { OrgLandingPort } from "@calcom/lib/domainManager/customHostnames/orgLanding";
import { ORG_LANDING_MAX_MEMBERS } from "@calcom/lib/domainManager/customHostnames/orgLanding";
import type { PrismaClient } from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import { withTwPlatform as withTwPlatformRaw } from "@calcom/prisma/tw-org-context";

type Tx = Prisma.TransactionClient;

const withTwPlatform = <R>(prisma: PrismaClient, reason: string, fn: (tx: Tx) => Promise<R>) =>
  withTwPlatformRaw<Tx, R>(prisma, reason, fn);

/** WC-TW-12f: read-only lookups for the public org landing page. Selects no email or contact field. */
export class OrgLandingRepository implements OrgLandingPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findActiveOrgBySlug(slug: string) {
    // tw_organization is forced-RLS; a public page has no session org, so the slug lookup needs platform context.
    const row = await withTwPlatform(this.prisma, "wc-tw-12f org landing: public slug -> org", (tx) =>
      tx.organization.findFirst({
        where: { slug: { equals: slug, mode: "insensitive" }, status: "active" },
        select: { id: true, slug: true, name: true, logoUrl: true, brand: true },
      })
    );
    return row ?? null;
  }

  async listOrgUsers(orgId: string) {
    return this.prisma.user.findMany({
      where: { twOrgId: orgId },
      select: { id: true, username: true, name: true, locked: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: ORG_LANDING_MAX_MEMBERS * 2,
    });
  }

  async listUsersByUsername(usernames: string[]) {
    const rows = await this.prisma.user.findMany({
      where: { username: { in: usernames, mode: "insensitive" } },
      select: { username: true, twOrgId: true },
      take: 500,
    });
    return rows.flatMap((r) => (r.username ? [{ username: r.username, twOrgId: r.twOrgId }] : []));
  }

  async listPublicEventTypes(userIds: number[]) {
    const rows = await this.prisma.eventType.findMany({
      where: { userId: { in: userIds }, teamId: null, hidden: false },
      select: { userId: true, slug: true, title: true, length: true, twOrgId: true },
      orderBy: [{ position: "desc" }, { id: "asc" }],
      take: 500,
    });
    return rows.flatMap((r) => (r.userId === null ? [] : [{ ...r, userId: r.userId }]));
  }

  async listTeamEventTypesBySlug(slug: string) {
    const rows = await this.prisma.eventType.findMany({
      where: { team: { slug: { equals: slug, mode: "insensitive" } }, hidden: false },
      select: {
        teamId: true,
        slug: true,
        title: true,
        length: true,
        twOrgId: true,
        schedulingType: true,
        team: { select: { slug: true } },
      },
      orderBy: [{ position: "desc" }, { id: "asc" }],
      take: 200,
    });
    return rows.flatMap((r) =>
      r.teamId === null
        ? []
        : [
            {
              teamId: r.teamId,
              teamSlug: r.team?.slug ?? "",
              slug: r.slug,
              title: r.title,
              length: r.length,
              twOrgId: r.twOrgId,
              managed: r.schedulingType === "MANAGED",
            },
          ]
    );
  }
}
