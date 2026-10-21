import { describe, expect, it } from "vitest";
import { deliverabilityRates } from "../deliverabilityRates";
import { normalizeSendgridEvents } from "../normalizeSendgridEvents";

describe("normalizeSendgridEvents", () => {
  it("maps ledger events, keeps domain only and drops unknown or malformed entries", () => {
    const { rows, skipped } = normalizeSendgridEvents([
      {
        sg_event_id: "ev-1",
        sg_message_id: "abcXYZ.filterdrecv-1-2-3.0",
        event: "bounce",
        email: "Jane.Doe@Example.COM",
        timestamp: 1_792_600_000,
        bookingUid: "bk_123",
        reason: "550 5.1.1 <jane.doe@example.com>: user unknown",
      },
      { sg_event_id: "ev-2", event: "open", email: "a@b.co", timestamp: 1_792_600_001 },
      { event: "delivered", timestamp: 1 },
      "garbage",
    ]);
    expect(skipped).toBe(3);
    expect(rows).toEqual([
      {
        sgEventId: "ev-1",
        sgMessageId: "abcXYZ",
        event: "bounce",
        bookingUid: "bk_123",
        recipientDomain: "example.com",
        reason: "550 5.1.1 <***@example.com>: user unknown",
        occurredAt: new Date(1_792_600_000 * 1000),
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("jane");
  });

  it("truncates reason to 500 chars and tolerates a non-array payload", () => {
    const { rows } = normalizeSendgridEvents([
      { sg_event_id: "ev-3", event: "deferred", timestamp: 1, response: "x".repeat(900) },
    ]);
    expect(rows[0].reason).toHaveLength(500);
    expect(rows[0].recipientDomain).toBeNull();
    expect(normalizeSendgridEvents({ event: "bounce" })).toEqual({ rows: [], skipped: 0 });
  });
});

describe("deliverabilityRates", () => {
  it("computes bounce over processed and complaints over delivered", () => {
    const r = deliverabilityRates({ processed: 1000, delivered: 990, bounce: 6, dropped: 2, spamreport: 1 });
    expect(r.bouncePct).toBe(0.8);
    expect(r.bounceOk).toBe(true);
    expect(r.complaintPct).toBe(0.1);
    expect(r.complaintOk).toBe(false);
  });

  it("reports no data rather than 0% when nothing was sent", () => {
    const r = deliverabilityRates({});
    expect(r.bouncePct).toBeNull();
    expect(r.bounceOk).toBeNull();
  });
});
