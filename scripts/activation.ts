/**
 * WC-TW-9b — "Activation <= 7 days" per org, by signup-week cohort (Bible WC-9 step 2,
 * WC.2.5 target >= 40%).
 *
 * Activated = the org has calendar_connected, event_type_published and
 * first_external_booking in tw_activation_event, each with
 * occurredAt <= tw_organization.createdAt + 7 days.
 *
 * Read-only: one READ ONLY transaction, named-column SELECT, platform RLS context
 * (tw_* tables are FORCE RLS). No backfill exists (card decision 5), so cohorts
 * before the ledger's deploy date read as 0% by construction: pass --since.
 *
 *   yarn ts-node --transpile-only scripts/activation.ts [--since YYYY-MM-DD] [--json]
 */
import process from "node:process";

import { prisma } from "@calcom/prisma";
import { withTwPlatform } from "@calcom/prisma/tw-org-context";

type CohortRow = { cohort_week: Date; orgs: number; activated: number };

function pct(activated: number, orgs: number): string {
  return orgs === 0 ? "-" : `${((activated / orgs) * 100).toFixed(1)}%`;
}

function parseArgs(argv: string[]) {
  const sinceIdx = argv.indexOf("--since");
  const since = sinceIdx >= 0 ? new Date(`${argv[sinceIdx + 1]}T00:00:00Z`) : new Date(0);
  if (Number.isNaN(since.getTime())) throw new Error("--since expects YYYY-MM-DD");
  return { since, json: argv.includes("--json") };
}

async function main() {
  const { since, json } = parseArgs(process.argv.slice(2));
  const rows = await withTwPlatform(prisma, "WC-TW-9b activation report (read-only)", async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return tx.$queryRaw<CohortRow[]>`
      WITH org_kinds AS (
        SELECT o."id" AS org_id,
               o."createdAt" AS org_created_at,
               count(DISTINCT e."kind") FILTER (
                 WHERE e."occurredAt" <= o."createdAt" + interval '7 days'
               ) AS kinds_in_window
          FROM "tw_organization" o
          LEFT JOIN "tw_activation_event" e ON e."twOrgId" = o."id"
         WHERE o."createdAt" >= ${since}
           AND o."isSandbox" = false
         GROUP BY o."id", o."createdAt"
      )
      SELECT date_trunc('week', org_created_at) AS cohort_week,
             count(*)::int AS orgs,
             count(*) FILTER (WHERE kinds_in_window = 3)::int AS activated
        FROM org_kinds
       GROUP BY 1
       ORDER BY 1`;
  });

  const total = rows.reduce((a, r) => ({ orgs: a.orgs + r.orgs, activated: a.activated + r.activated }), {
    orgs: 0,
    activated: 0,
  });
  if (json) {
    console.log(JSON.stringify({ since: since.toISOString(), cohorts: rows, total }, null, 2));
    return;
  }
  console.log(`activation <= 7 days (target >= 40%), cohorts since ${since.toISOString().slice(0, 10)}`);
  console.log("week_of     orgs  activated  pct");
  for (const r of rows) {
    const wk = new Date(r.cohort_week).toISOString().slice(0, 10);
    console.log(`${wk}  ${String(r.orgs).padStart(4)}  ${String(r.activated).padStart(9)}  ${pct(r.activated, r.orgs)}`);
  }
  console.log(`total       ${String(total.orgs).padStart(4)}  ${String(total.activated).padStart(9)}  ${pct(total.activated, total.orgs)}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
