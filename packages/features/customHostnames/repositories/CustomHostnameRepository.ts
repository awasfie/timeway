import type {
  CustomHostnameRepositoryPort,
  CustomHostnameUpdate,
} from "@calcom/lib/domainManager/customHostnames/types";
import { HostnameTakenError } from "@calcom/lib/domainManager/customHostnames/types";
import type { PrismaClient } from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import {
  withTwOrg as withTwOrgRaw,
  withTwPlatform as withTwPlatformRaw,
} from "@calcom/prisma/tw-org-context";

type Tx = Prisma.TransactionClient;

const withTwOrg = <R>(prisma: PrismaClient, orgId: string, fn: (tx: Tx) => Promise<R>) =>
  withTwOrgRaw<Tx, R>(prisma, orgId, fn);
const withTwPlatform = <R>(prisma: PrismaClient, reason: string, fn: (tx: Tx) => Promise<R>) =>
  withTwPlatformRaw<Tx, R>(prisma, reason, fn);

const rowSelect = {
  id: true,
  orgId: true,
  hostname: true,
  status: true,
  sslStatus: true,
  lastError: true,
  cnameVerifiedAt: true,
  lastCheckedAt: true,
  activatedAt: true,
  createdAt: true,
} as const;

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

export class CustomHostnameRepository implements CustomHostnameRepositoryPort {
  constructor(private readonly prisma: PrismaClient) {}

  findByOrg(orgId: string) {
    return withTwOrg(this.prisma, orgId, (tx) =>
      tx.twCustomHostname.findUnique({ where: { orgId }, select: rowSelect })
    );
  }

  async create(orgId: string, hostname: string) {
    try {
      return await withTwOrg(this.prisma, orgId, (tx) =>
        tx.twCustomHostname.create({ data: { orgId, hostname }, select: rowSelect })
      );
    } catch (e) {
      if (isUniqueViolation(e)) throw new HostnameTakenError();
      throw e;
    }
  }

  update(orgId: string, id: string, data: CustomHostnameUpdate) {
    return withTwOrg(this.prisma, orgId, (tx) =>
      tx.twCustomHostname.update({ where: { id }, data, select: rowSelect })
    );
  }

  async deleteByOrg(orgId: string) {
    const res = await withTwOrg(this.prisma, orgId, (tx) =>
      tx.twCustomHostname.deleteMany({ where: { orgId } })
    );
    return res.count;
  }

  findForApproval(hostname: string) {
    return withTwPlatform(this.prisma, "wc-tw-12b approval endpoint: exact hostname lookup", (tx) =>
      tx.twCustomHostname.findUnique({ where: { hostname }, select: { status: true, cnameVerifiedAt: true } })
    );
  }

  listNeverActivatedBefore(cutoff: Date) {
    return withTwPlatform(this.prisma, "wc-tw-12b cleanup: stale hostname candidates", (tx) =>
      tx.twCustomHostname.findMany({
        where: { status: { not: "active" }, activatedAt: null, createdAt: { lt: cutoff } },
        select: { id: true, orgId: true, hostname: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      })
    );
  }

  async deleteIfStillStale(id: string, cutoff: Date) {
    const res = await withTwPlatform(this.prisma, "wc-tw-12b cleanup: delete one stale hostname", (tx) =>
      tx.twCustomHostname.deleteMany({
        where: { id, status: { not: "active" }, activatedAt: null, createdAt: { lt: cutoff } },
      })
    );
    return res.count === 1;
  }

  async listAdminOrgIds(userId: number) {
    const rows = await withTwPlatform(this.prisma, "wc-tw-12b: session user's admin org memberships", (tx) =>
      tx.organizationMember.findMany({
        where: { userId, role: { in: ["owner", "admin"] } },
        select: { orgId: true },
      })
    );
    return rows.map((r) => r.orgId);
  }
}
