import logger from "@calcom/lib/logger";
import { safeStringify } from "@calcom/lib/safeStringify";
import prisma from "@calcom/prisma";
import { withTwOrg } from "@calcom/prisma/tw-org-context";
import { Prisma } from "@calcom/prisma/client";
import { z } from "zod";

/**
 * WC-TW-13e (G6). Timeway reports the paid-booking amount to Passport and nothing else: the fee
 * percentage is the Passport metered Price from PART CM, so a fee change needs no Timeway deploy.
 * This module must never hold a rate; platformFee.grep.test.ts enforces that.
 *
 * Delivery reuses the Tasker outbox (Task table): one task per Payment uid and kind, deduplicated by
 * the Task (referenceUid, type) unique index, retried with exponential backoff by TaskProcessor.
 * Enqueue errors are logged and swallowed so Passport never fails a booking.
 */

const log = logger.getSubLogger({ prefix: ["payment-gateway:platform-fee"] });

export const PLATFORM_FEE_TASK = "platformFeeUsage" as const;
export const PLATFORM_FEE_PRODUCT = "TIMEWAY" as const;
export const PLATFORM_FEE_METER = "timeway_paid_booking_volume" as const;
export const PLATFORM_FEE_FLAG = "TW_PLATFORM_FEE_USAGE_ENABLED" as const;

/**
 * Passport identifier = orgId:TIMEWAY:period:seq and the seq space is shared by every Timeway meter.
 * Seqs below this bound belong to the paid-booking line and derive from Payment.id, so a retry, a
 * duplicate webhook or a re-enqueue is always the same identifier. Any future Timeway meter must
 * allocate seqs at or above this bound.
 */
export const PLATFORM_FEE_SEQ_CEILING = 1_000_000_000;

export const platformFeeUsagePayloadSchema = z.object({
  kind: z.enum(["charge", "refund"]),
  idempotencyKey: z.string().regex(/^tw-fee(-refund)?:.+$/),
  product: z.literal(PLATFORM_FEE_PRODUCT),
  meter: z.literal(PLATFORM_FEE_METER),
  paymentId: z.number().int().positive(),
  paymentUid: z.string().min(1),
  /** Booking amount in minor units; negative for the refund correction. */
  value: z.number().int(),
  currency: z.string().min(3),
  /** Timeway org (tw_organization.id); Passport's org id is resolved at send time. */
  twOrgId: z.string().uuid(),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  seq: z.number().int().min(0).max(PLATFORM_FEE_SEQ_CEILING - 1),
  /** Unix seconds when the payment or refund happened; re-sent as-is so a retry is a replay. */
  timestamp: z.number().int().nonnegative(),
});

export type PlatformFeeUsagePayload = z.infer<typeof platformFeeUsagePayloadSchema>;
export type PlatformFeeKind = PlatformFeeUsagePayload["kind"];

export function isPlatformFeeUsageEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[PLATFORM_FEE_FLAG] === "true";
}

export function platformFeeIdempotencyKey(kind: PlatformFeeKind, paymentUid: string): string {
  return kind === "charge" ? `tw-fee:${paymentUid}` : `tw-fee-refund:${paymentUid}`;
}

export function platformFeeSeq(kind: PlatformFeeKind, paymentId: number): number {
  const seq = paymentId * 2 + (kind === "refund" ? 1 : 0);
  if (!Number.isSafeInteger(seq) || seq >= PLATFORM_FEE_SEQ_CEILING) {
    throw new Error(`Payment ${paymentId} is past the platform-fee seq range`);
  }
  return seq;
}

function utcPeriod(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type FeePayment = {
  id: number;
  uid: string;
  amount: number;
  currency: string;
  success: boolean;
  refunded: boolean;
  booking: { twOrgId: string | null } | null;
};

type EnqueueDeps = {
  findPayment: (paymentId: number) => Promise<FeePayment | null>;
  createTask: (payload: PlatformFeeUsagePayload, referenceUid: string) => Promise<unknown>;
  now: () => Date;
  env: NodeJS.ProcessEnv;
};

export const PLATFORM_FEE_MAX_ATTEMPTS = 12;

const defaultEnqueueDeps: EnqueueDeps = {
  findPayment: (paymentId) =>
    prisma.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        uid: true,
        amount: true,
        currency: true,
        success: true,
        refunded: true,
        booking: { select: { twOrgId: true } },
      },
    }),
  createTask: async (payload, referenceUid) => {
    const { default: tasker } = await import("@calcom/features/tasker");
    return tasker.create(PLATFORM_FEE_TASK, payload, {
      referenceUid,
      maxAttempts: PLATFORM_FEE_MAX_ATTEMPTS,
    });
  },
  now: () => new Date(),
  env: process.env,
};

export type EnqueueOutcome =
  | "disabled"
  | "payment_not_found"
  | "not_paid"
  | "not_refunded"
  | "zero_amount"
  | "no_org"
  | "duplicate"
  | "enqueued"
  | "error";

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Enqueue the usage line for one Payment. Idempotent per (Payment uid, kind): the Task referenceUid
 * is the Passport idempotency key, so a duplicate webhook or a second refund call adds nothing.
 * Never throws.
 */
export async function enqueuePlatformFeeUsage(
  input: { paymentId: number; kind: PlatformFeeKind },
  deps: Partial<EnqueueDeps> = {}
): Promise<EnqueueOutcome> {
  const d = { ...defaultEnqueueDeps, ...deps };
  const { paymentId, kind } = input;
  if (!isPlatformFeeUsageEnabled(d.env)) return "disabled";
  try {
    const payment = await d.findPayment(paymentId);
    if (!payment) return "payment_not_found";
    if (!payment.success) return "not_paid";
    if (kind === "refund" && !payment.refunded) return "not_refunded";
    if (payment.amount <= 0) return "zero_amount";
    const twOrgId = payment.booking?.twOrgId;
    if (!twOrgId) {
      log.warn("Paid booking has no Timeway org; fee line not enqueued", safeStringify({ paymentId, kind }));
      return "no_org";
    }

    const at = d.now();
    const idempotencyKey = platformFeeIdempotencyKey(kind, payment.uid);
    const payload = platformFeeUsagePayloadSchema.parse({
      kind,
      idempotencyKey,
      product: PLATFORM_FEE_PRODUCT,
      meter: PLATFORM_FEE_METER,
      paymentId: payment.id,
      paymentUid: payment.uid,
      value: kind === "charge" ? payment.amount : -payment.amount,
      currency: payment.currency.toUpperCase(),
      twOrgId,
      period: utcPeriod(at),
      seq: platformFeeSeq(kind, payment.id),
      timestamp: Math.floor(at.getTime() / 1000),
    });

    try {
      await d.createTask(payload, idempotencyKey);
    } catch (error) {
      if (isUniqueViolation(error)) return "duplicate";
      throw error;
    }
    return "enqueued";
  } catch (error) {
    log.error("Platform-fee usage enqueue failed", safeStringify({ paymentId, kind, error }));
    return "error";
  }
}

export type PassportUsageResponse = { status: number; body: unknown };

export type SendDeps = {
  resolvePassportOrgId: (twOrgId: string) => Promise<string | null>;
  postUsage: (
    body: Record<string, unknown>,
    idempotencyKey: string,
    env: NodeJS.ProcessEnv
  ) => Promise<PassportUsageResponse>;
  env: NodeJS.ProcessEnv;
};

const defaultSendDeps: SendDeps = {
  resolvePassportOrgId: async (twOrgId) => {
    const org = await withTwOrg(prisma, twOrgId, (tx) =>
      tx.organization.findUnique({
        where: { id: twOrgId },
        select: { identityMode: true, externalRef: true },
      })
    );
    if (!org || org.identityMode !== "passport" || !org.externalRef) return null;
    return org.externalRef;
  },
  postUsage: async (body, idempotencyKey, env) => {
    const base = env.PASSPORT_URL;
    const token = env.PASSPORT_USAGE_TOKEN;
    if (!base || !token) throw new Error("PASSPORT_URL or PASSPORT_USAGE_TOKEN is not set");
    const res = await fetch(`${base.replace(/\/+$/, "")}/v1/usage`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // keep raw text for lastError
    }
    return { status: res.status, body: parsed };
  },
  env: process.env,
};

/**
 * Body for Passport POST /v1/usage (WC-PE-14a ReportUsageDto). Passport rejects unknown fields, so
 * currency and paymentUid travel in the Idempotency-Key and the Task payload, not the body.
 */
export function toPassportUsageBody(payload: PlatformFeeUsagePayload, passportOrgId: string) {
  return {
    organizationId: passportOrgId,
    meter: payload.meter,
    period: payload.period,
    seq: payload.seq,
    value: payload.value,
    timestamp: payload.timestamp,
  };
}

/**
 * Task handler. Throwing makes TaskProcessor retry on the tasksConfig backoff; returning marks the
 * line sent. 2xx and 409 (already recorded) are sent; everything else (5xx, 4xx, network, org not linked yet) retries so the line
 * stays visible in the Task table until it lands or exhausts its attempts.
 */
export async function sendPlatformFeeUsage(rawPayload: string, deps: Partial<SendDeps> = {}): Promise<void> {
  const d = { ...defaultSendDeps, ...deps };
  const payload = platformFeeUsagePayloadSchema.parse(JSON.parse(rawPayload));
  const passportOrgId = await d.resolvePassportOrgId(payload.twOrgId);
  if (!passportOrgId) {
    throw new Error(`Timeway org ${payload.twOrgId} is not linked to a Passport organization`);
  }
  const res = await d.postUsage(toPassportUsageBody(payload, passportOrgId), payload.idempotencyKey, d.env);
  if (res.status >= 200 && res.status < 300) {
    log.info("Platform-fee usage sent", safeStringify({ key: payload.idempotencyKey, status: res.status }));
    return;
  }
  // Passport's only 409 on /v1/usage is USAGE_IDENTIFIER_REUSED: the identifier (fixed per Payment
  // and kind) is already held, so the line is counted and retrying can never change the answer.
  if (res.status === 409) {
    log.warn("Platform-fee usage already recorded", safeStringify({ key: payload.idempotencyKey }));
    return;
  }
  const detail = (typeof res.body === "string" ? res.body : JSON.stringify(res.body ?? null)).slice(0, 300);
  throw new Error(`Passport /v1/usage answered ${res.status} for ${payload.idempotencyKey}: ${detail}`);
}
