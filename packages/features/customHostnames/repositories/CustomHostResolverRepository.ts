import type { CustomHostResolverPort } from "@calcom/lib/domainManager/customHostnames/resolve";
import type { PrismaClient } from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import { withTwPlatform as withTwPlatformRaw } from "@calcom/prisma/tw-org-context";

type Tx = Prisma.TransactionClient;

const withTwPlatform = <R>(prisma: PrismaClient, reason: string, fn: (tx: Tx) => Promise<R>) =>
  withTwPlatformRaw<Tx, R>(prisma, reason, fn);

/** WC-TW-12c2: read-only lookups behind /api/internal/custom-domain/resolve. */
export class CustomHostResolverRepository implements CustomHostResolverPort {
  constructor(private readonly prisma: PrismaClient) {}

  async findActiveOrgByHostname(hostname: string) {
    const row = await withTwPlatform(this.prisma, "wc-tw-12c2 resolve: active hostname -> org", (tx) =>
      tx.twCustomHostname.findFirst({
        where: { hostname, status: "active" },
        select: { orgId: true, org: { select: { slug: true, status: true } } },
      })
    );
    if (!row || row.org.status !== "active") return null;
    return { orgId: row.orgId, orgSlug: row.org.slug };
  }

  async listUsersByUsername(usernames: string[]) {
    const rows = await this.prisma.user.findMany({
      where: { username: { in: usernames, mode: "insensitive" } },
      select: { username: true, twOrgId: true },
      take: 200,
    });
    return rows.flatMap((r) => (r.username ? [{ username: r.username, twOrgId: r.twOrgId }] : []));
  }

  async listTeamsBySlug(slug: string) {
    const rows = await this.prisma.team.findMany({
      where: { slug: { equals: slug, mode: "insensitive" } },
      select: {
        slug: true,
        parent: { select: { slug: true } },
        eventTypes: { select: { twOrgId: true }, take: 50 },
      },
      take: 50,
    });
    return rows.map((r) => ({
      slug: r.slug ?? "",
      parentSlug: r.parent?.slug ?? null,
      eventTypeOrgIds: r.eventTypes.map((e) => e.twOrgId),
    }));
  }
}
