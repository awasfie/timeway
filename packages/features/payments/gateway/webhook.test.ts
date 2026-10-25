import { HttpError } from "@calcom/lib/http-error";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@calcom/app-store/_utils/payments/handlePaymentSuccess", () => ({ handlePaymentSuccess: vi.fn() }));
vi.mock("@calcom/prisma", () => ({ default: { payment: { findFirst: vi.fn() } } }));

import type { GatewayWebhookEvent, GatewayWebhookPayment } from "./webhook";
import { processGatewayWebhook } from "./webhook";

const basePayment: GatewayWebhookPayment = {
  id: 7,
  uid: "pay-uid",
  bookingId: 42,
  amount: 12345,
  currency: "KWD",
  success: false,
  appId: "tap",
  booking: { userId: 1, eventType: { teamId: null } },
};

function makeDeps(payment: GatewayWebhookPayment | null) {
  const order: string[] = [];
  const deps = {
    findPaymentByExternalId: vi.fn(async () => {
      order.push("find");
      return payment;
    }),
    markPaid: vi.fn(async () => {
      order.push("markPaid");
      throw new HttpError({ statusCode: 200, message: "paid" });
    }),
  };
  return { deps, order };
}

function makeEvent(overrides: Partial<GatewayWebhookEvent> = {}, order?: string[]): GatewayWebhookEvent {
  return {
    appSlug: "tap",
    externalId: "chg_1",
    amountMinor: 12345,
    currency: "kwd",
    paid: true,
    verifySignature: vi.fn(() => {
      order?.push("verify");
      return true;
    }),
    ...overrides,
  };
}

describe("processGatewayWebhook (WC-TW-13 G5)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("verifies, then marks paid via handlePaymentSuccess", async () => {
    const { deps, order } = makeDeps(basePayment);
    const result = await processGatewayWebhook(makeEvent({}, order), deps);
    expect(result).toEqual({ outcome: "paid", httpStatus: 200, paymentId: 7 });
    expect(order).toEqual(["find", "verify", "markPaid"]);
    expect(deps.findPaymentByExternalId).toHaveBeenCalledWith("tap", "chg_1");
    expect(deps.markPaid).toHaveBeenCalledWith(
      expect.objectContaining({ paymentId: 7, bookingId: 42, appSlug: "tap" })
    );
  });

  it("bad signature: 401, nothing marked paid, even for a matching amount", async () => {
    const { deps } = makeDeps(basePayment);
    const result = await processGatewayWebhook(makeEvent({ verifySignature: () => false }), deps);
    expect(result.outcome).toBe("invalid_signature");
    expect(result.httpStatus).toBe(401);
    expect(deps.markPaid).not.toHaveBeenCalled();
  });

  it("a throwing verifier fails closed", async () => {
    const { deps } = makeDeps(basePayment);
    const result = await processGatewayWebhook(
      makeEvent({
        verifySignature: () => {
          throw new Error("no credential");
        },
      }),
      deps
    );
    expect(result.outcome).toBe("invalid_signature");
    expect(deps.markPaid).not.toHaveBeenCalled();
  });

  it("signature is checked before idempotency (no oracle on paid state)", async () => {
    const { deps } = makeDeps({ ...basePayment, success: true });
    const result = await processGatewayWebhook(makeEvent({ verifySignature: () => false }), deps);
    expect(result.outcome).toBe("invalid_signature");
  });

  it("idempotent: an already-paid payment is not processed again", async () => {
    const { deps } = makeDeps({ ...basePayment, success: true });
    const result = await processGatewayWebhook(makeEvent(), deps);
    expect(result).toEqual({ outcome: "already_paid", httpStatus: 200, paymentId: 7 });
    expect(deps.markPaid).not.toHaveBeenCalled();
  });

  it("unknown externalId: 200, nothing marked paid", async () => {
    const { deps } = makeDeps(null);
    const event = makeEvent();
    const result = await processGatewayWebhook(event, deps);
    expect(result).toEqual({ outcome: "payment_not_found", httpStatus: 200 });
    expect(event.verifySignature).not.toHaveBeenCalled();
    expect(deps.markPaid).not.toHaveBeenCalled();
  });

  it("provider reports not paid: 200, nothing marked paid", async () => {
    const { deps } = makeDeps(basePayment);
    const result = await processGatewayWebhook(makeEvent({ paid: false }), deps);
    expect(result.outcome).toBe("not_paid");
    expect(deps.markPaid).not.toHaveBeenCalled();
  });

  it.each([12344, 12346, 1234.5, 0])("amount mismatch %s: 200, nothing marked paid", async (amountMinor) => {
    const { deps } = makeDeps(basePayment);
    const result = await processGatewayWebhook(makeEvent({ amountMinor }), deps);
    expect(result).toEqual({ outcome: "amount_mismatch", httpStatus: 200, paymentId: 7 });
    expect(deps.markPaid).not.toHaveBeenCalled();
  });

  it("currency mismatch: 200, nothing marked paid", async () => {
    const { deps } = makeDeps(basePayment);
    const result = await processGatewayWebhook(makeEvent({ currency: "BHD" }), deps);
    expect(result).toEqual({ outcome: "currency_mismatch", httpStatus: 200, paymentId: 7 });
    expect(deps.markPaid).not.toHaveBeenCalled();
  });

  it("a real failure in handlePaymentSuccess propagates", async () => {
    const { deps } = makeDeps(basePayment);
    deps.markPaid.mockRejectedValueOnce(new Error("db down"));
    await expect(processGatewayWebhook(makeEvent(), deps)).rejects.toThrow("db down");
  });
});
