/**
 * WC-TW-8c / WC.2.5 Friday line: invite bounce % and complaint % over the last N days (default 7)
 * from tw_email_event. Read-only.
 *
 *   yarn ts-node --transpile-only scripts/email-deliverability.ts [days]
 */

import process from "node:process";
import {
  BOUNCE_TARGET_PCT,
  COMPLAINT_TARGET_PCT,
  deliverabilityRates,
} from "@calcom/features/email-events/lib/deliverabilityRates";
import { EmailEventRepository } from "@calcom/features/email-events/repositories/EmailEventRepository";
import { prisma } from "@calcom/prisma";

const fmt = (v: number | null) => (v === null ? "n/a" : `${v.toFixed(2)}%`);
const verdict = (ok: boolean | null) => (ok === null ? "NO DATA" : ok ? "OK" : "OVER");

async function main() {
  const days = Number(process.argv[2] ?? 7);
  if (!Number.isInteger(days) || days < 1 || days > 90)
    throw new Error(`days must be 1..90, got ${process.argv[2]}`);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const counts = await new EmailEventRepository(prisma).countByEventSince(since);
  const r = deliverabilityRates(counts);
  console.log(`email deliverability ${days}d since ${since.toISOString()}`);
  console.log(`events ${JSON.stringify(counts)}`);
  console.log(
    `bounce ${fmt(r.bouncePct)} (${r.bounced}/${r.processed}, target < ${BOUNCE_TARGET_PCT}%) ${verdict(r.bounceOk)}`
  );
  console.log(
    `complaint ${fmt(r.complaintPct)} (${r.complaints}/${r.delivered}, target < ${COMPLAINT_TARGET_PCT}%) ${verdict(r.complaintOk)}`
  );
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
