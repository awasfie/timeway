import { z } from "zod";

export const LEDGER_EVENTS = [
  "processed",
  "delivered",
  "bounce",
  "dropped",
  "deferred",
  "spamreport",
  "unsubscribe",
] as const;

export type LedgerEvent = (typeof LEDGER_EVENTS)[number];

export type EmailEventRow = {
  sgEventId: string;
  sgMessageId: string | null;
  event: LedgerEvent;
  bookingUid: string | null;
  recipientDomain: string | null;
  reason: string | null;
  occurredAt: Date;
};

const REASON_MAX = 500;
const EMAIL_IN_TEXT = /[^\s<>,;"'()[\]]+@([^\s<>,;"'()[\]]+)/g;

const rawEventSchema = z
  .object({
    sg_event_id: z.string().min(1).max(200),
    sg_message_id: z.string().max(300).optional(),
    event: z.string().max(50),
    email: z.string().max(320).optional(),
    timestamp: z.number().int().positive(),
    bookingUid: z.string().max(200).optional(),
    reason: z.string().optional(),
    response: z.string().optional(),
  })
  .passthrough();

function isLedgerEvent(value: string): value is LedgerEvent {
  return (LEDGER_EVENTS as readonly string[]).includes(value);
}

function domainOf(email: string | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 0 || at === email.length - 1) return null;
  return (
    email
      .slice(at + 1)
      .trim()
      .toLowerCase()
      .slice(0, 253) || null
  );
}

/** Bounce/defer texts often quote the recipient address; keep only its domain. */
function redactReason(text: string | undefined): string | null {
  if (!text) return null;
  const redacted = text.replace(EMAIL_IN_TEXT, (_m, domain: string) => `***@${domain}`);
  return redacted.slice(0, REASON_MAX);
}

/** The event's sg_message_id is `<X-Message-Id>.filter…`; the prefix joins with the TW-MAIL-ID send log. */
function messageIdPrefix(id: string | undefined): string | null {
  if (!id) return null;
  return id.split(".")[0] || null;
}

/**
 * Maps the untrusted SendGrid payload to ledger rows. Unknown event types (open, click, group_*)
 * and malformed entries are dropped, never thrown, so one bad entry cannot lose the batch.
 */
export function normalizeSendgridEvents(payload: unknown): { rows: EmailEventRow[]; skipped: number } {
  if (!Array.isArray(payload)) return { rows: [], skipped: 0 };
  const rows: EmailEventRow[] = [];
  let skipped = 0;
  for (const entry of payload) {
    const parsed = rawEventSchema.safeParse(entry);
    if (!parsed.success || !isLedgerEvent(parsed.data.event)) {
      skipped++;
      continue;
    }
    const e = parsed.data;
    rows.push({
      sgEventId: e.sg_event_id,
      sgMessageId: messageIdPrefix(e.sg_message_id),
      event: e.event as LedgerEvent,
      bookingUid: e.bookingUid || null,
      recipientDomain: domainOf(e.email),
      reason: redactReason(e.reason ?? e.response),
      occurredAt: new Date(e.timestamp * 1000),
    });
  }
  return { rows, skipped };
}
