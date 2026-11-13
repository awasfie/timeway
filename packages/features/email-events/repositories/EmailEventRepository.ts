import type { PrismaClient } from "@calcom/prisma";
import type { EmailEventRow, LedgerEvent } from "../lib/normalizeSendgridEvents";

export class EmailEventRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** SendGrid retries deliveries; the unique sgEventId makes a re-delivered batch a no-op. */
  async insertMany(rows: EmailEventRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const result = await this.prisma.emailEvent.createMany({ data: rows, skipDuplicates: true });
    return result.count;
  }

  async countByEventSince(
    since: Date,
    opts: { excludeDomains?: readonly string[] } = {}
  ): Promise<Partial<Record<LedgerEvent, number>>> {
    const exclude = opts.excludeDomains ?? [];
    const groups = await this.prisma.emailEvent.groupBy({
      by: ["event"],
      where: {
        occurredAt: { gte: since },
        // recipientDomain is nullable: NOT IN alone would drop NULL rows, so keep them explicitly.
        ...(exclude.length > 0
          ? { OR: [{ recipientDomain: null }, { recipientDomain: { notIn: [...exclude] } }] }
          : {}),
      },
      _count: { _all: true },
    });
    const counts: Partial<Record<LedgerEvent, number>> = {};
    for (const g of groups) counts[g.event] = g._count._all;
    return counts;
  }
}
