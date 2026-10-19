import { handlePaymentSuccess } from "@calcom/app-store/_utils/payments/handlePaymentSuccess";
import { HttpError } from "@calcom/lib/http-error";
import logger from "@calcom/lib/logger";
import { safeStringify } from "@calcom/lib/safeStringify";
import { distributedTracing } from "@calcom/lib/tracing/factory";
import prisma from "@calcom/prisma";
import type { GatewayProviderSlug } from "./types";

const log = logger.getSubLogger({ prefix: ["payment-gateway:webhook"] });

export type GatewayWebhookPayment = {
  id: number;
  uid: string;
  bookingId: number;
  amount: number;
  currency: string;
  success: boolean;
  appId: string | null;
  booking: { userId: number | null; eventType: { teamId: number | null } | null } | null;
};

export type GatewayWebhookEvent = {
  appSlug: GatewayProviderSlug;
  /** Provider charge/intent id; matches Payment.externalId. */
  externalId: string;
  /** Amount reported by the provider, already converted to minor units with gateway/money.ts. */
  amountMinor: number;
  currency: string;
  /** True only when the provider reports a captured/successful charge. */
  paid: boolean;
  /**
   * Provider signature check. Gets the Payment row so the provider can load the org's own
   * credential (team or user) and verify with its secret. Must use a constant-time compare.
   */
  verifySignature: (payment: GatewayWebhookPayment) => boolean | Promise<boolean>;
};

export type GatewayWebhookOutcome =
  | "payment_not_found"
  | "invalid_signature"
  | "already_paid"
  | "not_paid"
  | "amount_mismatch"
  | "currency_mismatch"
  | "paid";

export type GatewayWebhookResult = {
  outcome: GatewayWebhookOutcome;
  /** HTTP status to answer the provider with. Only a bad signature is non-2xx. */
  httpStatus: 200 | 401;
  paymentId?: number;
};

type Deps = {
  findPaymentByExternalId: (appSlug: string, externalId: string) => Promise<GatewayWebhookPayment | null>;
  markPaid: typeof handlePaymentSuccess;
};

const defaultDeps: Deps = {
  findPaymentByExternalId: (appSlug, externalId) =>
    prisma.payment.findFirst({
      where: { externalId, appId: appSlug },
      select: {
        id: true,
        uid: true,
        bookingId: true,
        amount: true,
        currency: true,
        success: true,
        appId: true,
        booking: { select: { userId: true, eventType: { select: { teamId: true } } } },
      },
    }),
  markPaid: handlePaymentSuccess,
};

/**
 * Shared webhook path for every hosted-redirect gateway (WC-TW-13 G5). Order is fixed:
 * verify signature, then idempotency on externalId, then amount and currency must equal the
 * Payment row, then handlePaymentSuccess. A mismatch is logged and answered 200 so the provider
 * stops retrying, but the booking is not marked paid.
 */
export async function processGatewayWebhook(
  event: GatewayWebhookEvent,
  deps: Deps = defaultDeps
): Promise<GatewayWebhookResult> {
  const { appSlug, externalId } = event;
  const payment = await deps.findPaymentByExternalId(appSlug, externalId);
  if (!payment) {
    log.warn("Webhook for unknown payment", safeStringify({ appSlug, externalId }));
    return { outcome: "payment_not_found", httpStatus: 200 };
  }

  let signatureValid = false;
  try {
    signatureValid = await event.verifySignature(payment);
  } catch (error) {
    log.error("Signature verification threw", safeStringify({ appSlug, paymentId: payment.id, error }));
  }
  if (!signatureValid) {
    log.warn("Invalid webhook signature", safeStringify({ appSlug, paymentId: payment.id }));
    return { outcome: "invalid_signature", httpStatus: 401, paymentId: payment.id };
  }

  if (payment.success) {
    return { outcome: "already_paid", httpStatus: 200, paymentId: payment.id };
  }

  if (!event.paid) {
    return { outcome: "not_paid", httpStatus: 200, paymentId: payment.id };
  }

  if (!Number.isSafeInteger(event.amountMinor) || event.amountMinor !== payment.amount) {
    log.error(
      "Webhook amount does not match payment; not marking paid",
      safeStringify({ appSlug, paymentId: payment.id, expected: payment.amount, received: event.amountMinor })
    );
    return { outcome: "amount_mismatch", httpStatus: 200, paymentId: payment.id };
  }

  if (event.currency.toUpperCase() !== payment.currency.toUpperCase()) {
    log.error(
      "Webhook currency does not match payment; not marking paid",
      safeStringify({ appSlug, paymentId: payment.id, expected: payment.currency, received: event.currency })
    );
    return { outcome: "currency_mismatch", httpStatus: 200, paymentId: payment.id };
  }

  const traceContext = distributedTracing.createTrace(`${appSlug}_webhook`, {
    meta: { paymentId: payment.id, bookingId: payment.bookingId },
  });
  try {
    await deps.markPaid({ paymentId: payment.id, bookingId: payment.bookingId, appSlug, traceContext });
  } catch (error) {
    // handlePaymentSuccess signals success by throwing HttpError 200.
    if (!(error instanceof HttpError && error.statusCode === 200)) throw error;
  }
  return { outcome: "paid", httpStatus: 200, paymentId: payment.id };
}
