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

/**
 * Recipient domains that are our own test/seed addresses (t_f964e802 ruling): example.com is RFC 2606
 * reserved (SendGrid drops it as Invalid); 14x.co is the Bounced Address test domain. Excluded from the
 * headline bounce %; the script always prints the raw (unfiltered) figure beside it.
 */
export const TEST_RECIPIENT_DOMAINS = ["example.com", "14x.co"] as const;

/**
 * WC.2.5: bounce % = (bounce + dropped) / attempts; complaint % = spamreport / delivered.
 * attempts = processed when SendGrid sends it; the prod webhook delivers no `processed` events
 * (t_f964e802), so otherwise attempts = delivered + bounce + dropped (every terminal outcome).
 */
export function deliverabilityRates(counts: Partial<Record<LedgerEvent, number>>): DeliverabilityRates {
  const delivered = counts.delivered ?? 0;
  const bounced = (counts.bounce ?? 0) + (counts.dropped ?? 0);
  const processed = (counts.processed ?? 0) > 0 ? (counts.processed as number) : delivered + bounced;
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
