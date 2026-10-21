import type { LedgerEvent } from "./normalizeSendgridEvents";

export const BOUNCE_TARGET_PCT = 1;
export const COMPLAINT_TARGET_PCT = 0.1;

export type DeliverabilityRates = {
  processed: number;
  delivered: number;
  bounced: number;
  complaints: number;
  bouncePct: number | null;
  complaintPct: number | null;
  bounceOk: boolean | null;
  complaintOk: boolean | null;
};

const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 10000) / 100 : null);

/** WC.2.5: bounce % = (bounce + dropped) / processed; complaint % = spamreport / delivered. */
export function deliverabilityRates(counts: Partial<Record<LedgerEvent, number>>): DeliverabilityRates {
  const processed = counts.processed ?? 0;
  const delivered = counts.delivered ?? 0;
  const bounced = (counts.bounce ?? 0) + (counts.dropped ?? 0);
  const complaints = counts.spamreport ?? 0;
  const bouncePct = pct(bounced, processed);
  const complaintPct = pct(complaints, delivered);
  return {
    processed,
    delivered,
    bounced,
    complaints,
    bouncePct,
    complaintPct,
    bounceOk: bouncePct === null ? null : bouncePct < BOUNCE_TARGET_PCT,
    complaintOk: complaintPct === null ? null : complaintPct < COMPLAINT_TARGET_PCT,
  };
}
