import process from "node:process";
import type { GatewayWebhookPayment, GatewayWebhookResult } from "@calcom/features/payments/gateway/webhook";
import { processGatewayWebhook } from "@calcom/features/payments/gateway/webhook";
import logger from "@calcom/lib/logger";
import { safeStringify } from "@calcom/lib/safeStringify";
import prisma from "@calcom/prisma";
import type { Prisma } from "@calcom/prisma/client";
import Stripe from "stripe";

const log = logger.getSubLogger({ prefix: ["stripepayment:webhook"] });

const APP_SLUG = "stripe";

export type StripeWebhookOutcome =
  | GatewayWebhookResult["outcome"]
  | "not_configured"
  | "invalid_signature"
  | "ignored_event"
  | "not_refunded"
  | "already_refunded"
  | "refunded";

export type StripeWebhookResult = {
  outcome: StripeWebhookOutcome;
  httpStatus: 200 | 401 | 500;
  eventId?: string;
  paymentId?: number;
};

type RefundPayment = {
  id: number;
  success: boolean;
  refunded: boolean;
  data: Prisma.JsonValue;
};

type Deps = {
  processPayment: typeof processGatewayWebhook;
  findPaymentData: (paymentId: number) => Promise<Prisma.JsonValue | null>;
  findPaymentForRefund: (externalId: string) => Promise<RefundPayment | null>;
  markRefunded: (paymentId: number) => Promise<void>;
};

const defaultDeps: Deps = {
  processPayment: processGatewayWebhook,
  findPaymentData: async (paymentId) => {
    const row = await prisma.payment.findUnique({ where: { id: paymentId }, select: { data: true } });
    return row?.data ?? null;
  },
  findPaymentForRefund: (externalId) =>
    prisma.payment.findFirst({
      where: { externalId, appId: APP_SLUG },
      select: { id: true, success: true, refunded: true, data: true },
    }),
  markRefunded: async (paymentId) => {
    await prisma.payment.update({ where: { id: paymentId }, data: { refunded: true } });
  },
};

// Signature check does not use the API key; constructEvent only needs the endpoint secret.
const stripe = new Stripe(process.env.STRIPE_PRIVATE_KEY || "", { apiVersion: "2020-08-27" });

function recordedStripeAccount(data: Prisma.JsonValue | null): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const direct = (data as Record<string, unknown>).stripeAccount;
  return typeof direct === "string" && direct.length > 0 ? direct : null;
}

/**
 * The event must come from the connected account the Payment was created on (G2/G3): an event
 * without `account` is a platform-account event and never settles a customer payment.
 */
function sameConnectedAccount(event: Stripe.Event, data: Prisma.JsonValue | null): boolean {
  const recorded = recordedStripeAccount(data);
  return !!event.account && !!recorded && event.account === recorded;
}

async function handlePaymentIntentSucceeded(event: Stripe.Event, deps: Deps): Promise<StripeWebhookResult> {
  const intent = event.data.object as Stripe.PaymentIntent;
  const result = await deps.processPayment({
    appSlug: APP_SLUG,
    externalId: intent.id,
    // Payment.amount is stored in Stripe minor units (PaymentService.create passes it through).
    amountMinor: intent.amount_received,
    currency: intent.currency,
    paid: intent.status === "succeeded",
    verifySignature: async (payment: GatewayWebhookPayment) => {
      const ok = sameConnectedAccount(event, await deps.findPaymentData(payment.id));
      if (!ok)
        log.warn("Event account does not match payment account", safeStringify({ paymentId: payment.id }));
      return ok;
    },
  });
  return { ...result, eventId: event.id };
}

async function handleChargeRefunded(event: Stripe.Event, deps: Deps): Promise<StripeWebhookResult> {
  const charge = event.data.object as Stripe.Charge;
  const intentId =
    typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
  if (!intentId) return { outcome: "payment_not_found", httpStatus: 200, eventId: event.id };

  const payment = await deps.findPaymentForRefund(intentId);
  if (!payment) {
    log.warn("Refund webhook for unknown payment", safeStringify({ intentId }));
    return { outcome: "payment_not_found", httpStatus: 200, eventId: event.id };
  }
  if (!sameConnectedAccount(event, payment.data)) {
    log.warn("Refund event account does not match payment account", safeStringify({ paymentId: payment.id }));
    return { outcome: "invalid_signature", httpStatus: 401, eventId: event.id, paymentId: payment.id };
  }
  if (payment.refunded) {
    return { outcome: "already_refunded", httpStatus: 200, eventId: event.id, paymentId: payment.id };
  }
  // Partial refunds keep the booking paid; only a full refund flips Payment.refunded.
  if (!payment.success || charge.refunded !== true) {
    return { outcome: "not_refunded", httpStatus: 200, eventId: event.id, paymentId: payment.id };
  }
  await deps.markRefunded(payment.id);
  return { outcome: "refunded", httpStatus: 200, eventId: event.id, paymentId: payment.id };
}

/**
 * Stripe booking-payment webhook (WC-TW-13h). Signature is verified on the raw body before
 * anything is read; payment_intent.succeeded goes through the shared gateway path (idempotent,
 * amount and currency must equal the Payment row); charge.refunded flips Payment.refunded once.
 */
export async function handleStripeWebhook(
  input: { rawBody: string | Buffer; signature: string | undefined; secret?: string | undefined },
  deps: Deps = defaultDeps
): Promise<StripeWebhookResult> {
  const secret = input.secret ?? process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    log.error("STRIPE_WEBHOOK_SECRET is not set; refusing webhook");
    return { outcome: "not_configured", httpStatus: 500 };
  }
  if (!input.signature) return { outcome: "invalid_signature", httpStatus: 401 };

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(input.rawBody, input.signature, secret);
  } catch {
    log.warn("Invalid Stripe webhook signature");
    return { outcome: "invalid_signature", httpStatus: 401 };
  }

  switch (event.type) {
    case "payment_intent.succeeded":
      return handlePaymentIntentSucceeded(event, deps);
    case "charge.refunded":
      return handleChargeRefunded(event, deps);
    default:
      return { outcome: "ignored_event", httpStatus: 200, eventId: event.id };
  }
}
