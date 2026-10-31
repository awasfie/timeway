import Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@calcom/prisma", () => ({ default: {} }));
vi.mock("@calcom/app-store/_utils/payments/handlePaymentSuccess", () => ({ handlePaymentSuccess: vi.fn() }));

import type { GatewayWebhookPayment } from "@calcom/features/payments/gateway/webhook";
import { processGatewayWebhook } from "@calcom/features/payments/gateway/webhook";
import { HttpError } from "@calcom/lib/http-error";
import { handleStripeWebhook } from "./webhook";

const SECRET = "whsec_test_secret";
const CONNECTED = "acct_connected_test";
const stripe = new Stripe("sk_test_unused", { apiVersion: "2020-08-27" });

const basePayment: GatewayWebhookPayment = {
  id: 7,
  uid: "pay-uid",
  bookingId: 42,
  amount: 10000,
  currency: "aed",
  success: false,
  appId: "stripe",
  booking: { userId: 1, eventType: { teamId: null } },
};

function sign(payload: string, secret = SECRET) {
  return stripe.webhooks.generateTestHeaderString({ payload, secret });
}

function intentEvent(
  overrides: { amount?: number; currency?: string; account?: string | null; id?: string } = {}
) {
  const account = overrides.account === undefined ? CONNECTED : overrides.account;
  return JSON.stringify({
    id: overrides.id ?? "evt_1",
    object: "event",
    type: "payment_intent.succeeded",
    ...(account ? { account } : {}),
    data: {
      object: {
        id: "pi_1",
        object: "payment_intent",
        status: "succeeded",
        amount_received: overrides.amount ?? 10000,
        currency: overrides.currency ?? "aed",
      },
    },
  });
}

function refundEvent(refunded = true, account: string | null = CONNECTED) {
  return JSON.stringify({
    id: "evt_r1",
    object: "event",
    type: "charge.refunded",
    ...(account ? { account } : {}),
    data: { object: { id: "ch_1", object: "charge", payment_intent: "pi_1", refunded } },
  });
}

function makeDeps(payment: GatewayWebhookPayment | null) {
  const state = { payment: payment ? { ...payment } : null, refunded: false, markPaid: 0, markRefunded: 0 };
  const deps = {
    processPayment: (event: Parameters<typeof processGatewayWebhook>[0]) =>
      processGatewayWebhook(event, {
        findPaymentByExternalId: async () => state.payment,
        markPaid: async () => {
          state.markPaid += 1;
          if (state.payment) state.payment.success = true;
          throw new HttpError({ statusCode: 200, message: "paid" });
        },
      }),
    findPaymentData: vi.fn(async () => ({ stripeAccount: CONNECTED })),
    findPaymentForRefund: vi.fn(async () =>
      state.payment
        ? {
            id: state.payment.id,
            success: state.payment.success,
            refunded: state.refunded,
            data: { stripeAccount: CONNECTED },
          }
        : null
    ),
    markRefunded: vi.fn(async () => {
      state.markRefunded += 1;
      state.refunded = true;
    }),
  };
  return { deps, state };
}

describe("handleStripeWebhook", () => {
  beforeEach(() => vi.clearAllMocks());

  it("marks the payment paid on a signed payment_intent.succeeded", async () => {
    const { deps, state } = makeDeps(basePayment);
    const body = intentEvent();
    const result = await handleStripeWebhook({ rawBody: body, signature: sign(body), secret: SECRET }, deps);
    expect(result).toMatchObject({ outcome: "paid", httpStatus: 200, paymentId: 7, eventId: "evt_1" });
    expect(state.markPaid).toBe(1);
  });

  it("rejects a tampered body with 401 and does not touch the payment", async () => {
    const { deps, state } = makeDeps(basePayment);
    const body = intentEvent();
    const signature = sign(body);
    const tampered = body.replace("10000", "1");
    const result = await handleStripeWebhook({ rawBody: tampered, signature, secret: SECRET }, deps);
    expect(result).toEqual({ outcome: "invalid_signature", httpStatus: 401 });
    expect(state.markPaid).toBe(0);
  });

  it("rejects a signature made with another secret and a missing header", async () => {
    const { deps } = makeDeps(basePayment);
    const body = intentEvent();
    const wrong = await handleStripeWebhook(
      { rawBody: body, signature: sign(body, "whsec_other"), secret: SECRET },
      deps
    );
    const missing = await handleStripeWebhook({ rawBody: body, signature: undefined, secret: SECRET }, deps);
    expect(wrong.httpStatus).toBe(401);
    expect(missing.httpStatus).toBe(401);
  });

  it("refuses to run without a configured secret", async () => {
    const { deps } = makeDeps(basePayment);
    const body = intentEvent();
    const result = await handleStripeWebhook({ rawBody: body, signature: sign(body), secret: "" }, deps);
    expect(result).toEqual({ outcome: "not_configured", httpStatus: 500 });
  });

  it("does not mark paid when the amount differs from the Payment row", async () => {
    const { deps, state } = makeDeps(basePayment);
    const body = intentEvent({ amount: 9999 });
    const result = await handleStripeWebhook({ rawBody: body, signature: sign(body), secret: SECRET }, deps);
    expect(result).toMatchObject({ outcome: "amount_mismatch", httpStatus: 200 });
    expect(state.markPaid).toBe(0);
  });

  it("does not mark paid when the currency differs", async () => {
    const { deps, state } = makeDeps(basePayment);
    const body = intentEvent({ currency: "usd" });
    const result = await handleStripeWebhook({ rawBody: body, signature: sign(body), secret: SECRET }, deps);
    expect(result).toMatchObject({ outcome: "currency_mismatch" });
    expect(state.markPaid).toBe(0);
  });

  it("is idempotent: a duplicate delivery does not mark paid twice", async () => {
    const { deps, state } = makeDeps(basePayment);
    const body = intentEvent();
    const first = await handleStripeWebhook({ rawBody: body, signature: sign(body), secret: SECRET }, deps);
    const second = await handleStripeWebhook({ rawBody: body, signature: sign(body), secret: SECRET }, deps);
    expect(first.outcome).toBe("paid");
    expect(second).toMatchObject({ outcome: "already_paid", httpStatus: 200 });
    expect(state.markPaid).toBe(1);
  });

  it("refuses a platform-account event (no account) for a connected-account payment", async () => {
    const { deps, state } = makeDeps(basePayment);
    const body = intentEvent({ account: null });
    const result = await handleStripeWebhook({ rawBody: body, signature: sign(body), secret: SECRET }, deps);
    expect(result).toMatchObject({ outcome: "invalid_signature", httpStatus: 401 });
    expect(state.markPaid).toBe(0);
  });

  it("refuses an event from a different connected account", async () => {
    const { deps, state } = makeDeps(basePayment);
    const body = intentEvent({ account: "acct_someone_else" });
    const result = await handleStripeWebhook({ rawBody: body, signature: sign(body), secret: SECRET }, deps);
    expect(result.httpStatus).toBe(401);
    expect(state.markPaid).toBe(0);
  });

  it("answers 200 for an unknown payment and for ignored event types", async () => {
    const { deps } = makeDeps(null);
    const body = intentEvent();
    const unknown = await handleStripeWebhook({ rawBody: body, signature: sign(body), secret: SECRET }, deps);
    expect(unknown).toMatchObject({ outcome: "payment_not_found", httpStatus: 200 });

    const other = JSON.stringify({
      id: "evt_x",
      object: "event",
      type: "customer.created",
      data: { object: {} },
    });
    const ignored = await handleStripeWebhook(
      { rawBody: other, signature: sign(other), secret: SECRET },
      deps
    );
    expect(ignored).toMatchObject({ outcome: "ignored_event", httpStatus: 200 });
  });

  describe("charge.refunded", () => {
    it("flips Payment.refunded once on a full refund of a paid payment", async () => {
      const { deps, state } = makeDeps({ ...basePayment, success: true });
      const body = refundEvent();
      const first = await handleStripeWebhook({ rawBody: body, signature: sign(body), secret: SECRET }, deps);
      const second = await handleStripeWebhook(
        { rawBody: body, signature: sign(body), secret: SECRET },
        deps
      );
      expect(first).toMatchObject({ outcome: "refunded", httpStatus: 200, paymentId: 7 });
      expect(second).toMatchObject({ outcome: "already_refunded", httpStatus: 200 });
      expect(state.markRefunded).toBe(1);
    });

    it("leaves a partial refund as paid", async () => {
      const { deps, state } = makeDeps({ ...basePayment, success: true });
      const body = refundEvent(false);
      const result = await handleStripeWebhook(
        { rawBody: body, signature: sign(body), secret: SECRET },
        deps
      );
      expect(result.outcome).toBe("not_refunded");
      expect(state.markRefunded).toBe(0);
    });

    it("does not refund an unpaid payment", async () => {
      const { deps, state } = makeDeps(basePayment);
      const body = refundEvent();
      const result = await handleStripeWebhook(
        { rawBody: body, signature: sign(body), secret: SECRET },
        deps
      );
      expect(result.outcome).toBe("not_refunded");
      expect(state.markRefunded).toBe(0);
    });

    it("refuses a refund event from the platform account", async () => {
      const { deps, state } = makeDeps({ ...basePayment, success: true });
      const body = refundEvent(true, null);
      const result = await handleStripeWebhook(
        { rawBody: body, signature: sign(body), secret: SECRET },
        deps
      );
      expect(result.httpStatus).toBe(401);
      expect(state.markRefunded).toBe(0);
    });

    it("rejects a tampered refund body", async () => {
      const { deps, state } = makeDeps({ ...basePayment, success: true });
      const body = refundEvent(false);
      const signature = sign(body);
      const result = await handleStripeWebhook(
        { rawBody: body.replace('"refunded":false', '"refunded":true'), signature, secret: SECRET },
        deps
      );
      expect(result.httpStatus).toBe(401);
      expect(state.markRefunded).toBe(0);
    });
  });
});
