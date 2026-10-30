import logger from "@calcom/lib/logger";
import { safeStringify } from "@calcom/lib/safeStringify";
import prisma from "@calcom/prisma";
import { withTwOrg } from "@calcom/prisma/tw-org-context";
import { Prisma } from "@calcom/prisma/client";
import { z } from "zod";

/**
 * WC-TW-10c (WC-TW-10 step 3, INT-8). Every WhatsApp reminder Timeway sends is counted per org per UTC
 * month; a reminder past the plan's included count is one usage line on the Passport meter
 * `timeway_whatsapp_reminder_overage` (POST /v1/usage, Idempotency-Key = booking uid + message id).
 *
 * Counts come from the committed Bible PART CM.3 TIMEWAY (sections/CM-5.md "Confirmations" row,
 * unchanged by WC-8 row CM.3): Free and Pro have no WhatsApp reminders, Teams includes 200/mo,
 * Business includes 1,000/mo, then each extra reminder bills. The overage PRICE lives only in Passport
 * docs/billing/price-map.md / Stripe (PART CM, tax inclusive); this module never holds a rate.
 *
 * Ledger = the Tasker Task table: one task per sent reminder, referenceUid
 * `tw-wa:<YYYY-MM>:<twOrgId>:<bookingUid>:<window>` (unique per type), so the per-org/month count is a
 * prefix count and a re-enqueue is a duplicate. Included reminders are recorded (billable=false) and the
 * handler marks them done without calling Passport.
 *
 * Off unless TW_WA_METERING_ENABLED=true; while off the 10a sender behaves exactly as before.
 */

const log = logger.getSubLogger({ prefix: ["tw-whatsapp:metering"] });

export const WA_USAGE_TASK = "whatsappReminderUsage" as const;
export const WA_USAGE_METER = "timeway_whatsapp_reminder_overage" as const;
export const WA_METERING_FLAG = "TW_WA_METERING_ENABLED" as const;
export const WA_USAGE_MAX_ATTEMPTS = 12;

/** PART CM.3 TIMEWAY "Confirmations" row: WhatsApp reminders included per org per month, by plan. */
export const CM3_WHATSAPP_INCLUDED: Readonly<Record<string, number>> = Object.freeze({
  teams: 200,
  business: 1000,
});

/** Plan codes in CM.3 that bill extra reminders instead of stopping (Teams "then $0.02 each"; Business inherits). */
export function whatsappAllowance(planCode: string | null | undefined): number | null {
  if (!planCode) return null;
  const n = CM3_WHATSAPP_INCLUDED[planCode.trim().toLowerCase()];
  return typeof n === "number" ? n : null;
}

export function isWhatsappMeteringEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[WA_METERING_FLAG] === "true";
}

export function utcPeriod(at: Date): string {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function usageReferenceUid(period: string, twOrgId: string, bookingUid: string, windowMin: number): string {
  return `tw-wa:${period}:${twOrgId}:${bookingUid}:${windowMin}`;
}

/** Card WC-TW-10c: Idempotency-Key = booking uid + message id (window when Whatsaff returned no id). */
export function usageIdempotencyKey(bookingUid: string, messageId: string | null | undefined, windowMin: number): string {
  return `tw-wa:${bookingUid}:${messageId || `w${windowMin}`}`;
}

/** Passport ref `<kind>:<id>`, id = [A-Za-z0-9_-]{1,64}; stable per (booking, window) so a replay counts once. */
export function usageRef(bookingUid: string, windowMin: number): string {
  const id = `${bookingUid}-${windowMin}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
  return `wr:${id}`;
}

export const waUsagePayloadSchema = z.object({
  twOrgId: z.string().uuid(),
  bookingUid: z.string().min(1),
  windowMin: z.number().int().positive(),
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  /** 1-based position of this reminder in the org's month. */
  ordinal: z.number().int().positive(),
  included: z.number().int().nonnegative(),
  billable: z.boolean(),
  messageId: z.string().nullable(),
  idempotencyKey: z.string().regex(/^tw-wa:.+$/),
  ref: z.string().regex(/^wr:[A-Za-z0-9_-]{1,64}$/),
  timestamp: z.number().int().nonnegative(),
});
export type WaUsagePayload = z.infer<typeof waUsagePayloadSchema>;

export type OrgPlan = { twOrgId: string; planCode: string | null; parentPlanCode: string | null };

export type GateDecision =
  | { send: true; metered: false }
  | { send: true; metered: true; twOrgId: string; period: string; included: number; sentSoFar: number }
  | { send: false; reason: "metering_no_org" | "metering_plan_excludes_whatsapp" };

export type GateDeps = {
  loadOrgPlan: (twOrgId: string) => Promise<OrgPlan | null>;
  countSent: (period: string, twOrgId: string) => Promise<number>;
  env: NodeJS.ProcessEnv;
};

const defaultGateDeps: GateDeps = {
  loadOrgPlan: async (twOrgId) => {
    const org = await withTwOrg(prisma, twOrgId, (tx) =>
      tx.organization.findUnique({
        where: { id: twOrgId },
        select: { id: true, planCode: true, parentOrg: { select: { planCode: true } } },
      })
    );
    return org ? { twOrgId: org.id, planCode: org.planCode, parentPlanCode: org.parentOrg?.planCode ?? null } : null;
  },
  countSent: (period, twOrgId) =>
    prisma.task.count({
      where: { type: WA_USAGE_TASK, referenceUid: { startsWith: `tw-wa:${period}:${twOrgId}:` } },
    }),
  env: process.env,
};

/**
 * Decide before the send. Metering off: send as 10a did. Metering on: no org or a plan without WhatsApp
 * (Free, Pro, unknown) means no WhatsApp reminder; Teams/Business always send and bill past the allowance.
 * A sub-org inherits its parent's allowance when its own plan carries none (WC-TW-14 E4 pattern).
 */
export async function gateWhatsappReminder(
  input: { twOrgId: string | null; now: Date },
  deps: Partial<GateDeps> = {}
): Promise<GateDecision> {
  const d = { ...defaultGateDeps, ...deps };
  if (!isWhatsappMeteringEnabled(d.env)) return { send: true, metered: false };
  if (!input.twOrgId) return { send: false, reason: "metering_no_org" };
  const org = await d.loadOrgPlan(input.twOrgId);
  const included = whatsappAllowance(org?.planCode) ?? whatsappAllowance(org?.parentPlanCode);
  if (!org || included === null) return { send: false, reason: "metering_plan_excludes_whatsapp" };
  const period = utcPeriod(input.now);
  const sentSoFar = await d.countSent(period, input.twOrgId);
  return { send: true, metered: true, twOrgId: input.twOrgId, period, included, sentSoFar };
}

export function buildUsagePayload(
  gate: Extract<GateDecision, { metered: true }>,
  sent: { bookingUid: string; windowMin: number; messageId: string | null; at: Date }
): WaUsagePayload {
  const ordinal = gate.sentSoFar + 1;
  return {
    twOrgId: gate.twOrgId,
    bookingUid: sent.bookingUid,
    windowMin: sent.windowMin,
    period: gate.period,
    ordinal,
    included: gate.included,
    billable: ordinal > gate.included,
    messageId: sent.messageId,
    idempotencyKey: usageIdempotencyKey(sent.bookingUid, sent.messageId, sent.windowMin),
    ref: usageRef(sent.bookingUid, sent.windowMin),
    timestamp: Math.floor(sent.at.getTime() / 1000),
  };
}

export type RecordDeps = {
  createTask: (payload: WaUsagePayload, referenceUid: string) => Promise<unknown>;
};

const defaultRecordDeps: RecordDeps = {
  createTask: async (payload, referenceUid) => {
    const { default: tasker } = await import("@calcom/features/tasker");
    return tasker.create(WA_USAGE_TASK, JSON.stringify(payload), { referenceUid, maxAttempts: WA_USAGE_MAX_ATTEMPTS });
  },
};

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/** Record one sent reminder in the ledger. Never throws: metering must not fail a reminder. */
export async function recordWhatsappReminder(
  payload: WaUsagePayload,
  deps: Partial<RecordDeps> = {}
): Promise<"recorded" | "duplicate" | "error"> {
  const d = { ...defaultRecordDeps, ...deps };
  const referenceUid = usageReferenceUid(payload.period, payload.twOrgId, payload.bookingUid, payload.windowMin);
  try {
    await d.createTask(payload, referenceUid);
    return "recorded";
  } catch (error) {
    if (isUniqueViolation(error)) return "duplicate";
    log.error("WhatsApp reminder usage record failed", safeStringify({ referenceUid, error }));
    return "error";
  }
}

export type PassportUsageResponse = { status: number; body: unknown };

export type SendDeps = {
  resolvePassportOrgId: (twOrgId: string) => Promise<string | null>;
  postUsage: (body: Record<string, unknown>, idempotencyKey: string, env: NodeJS.ProcessEnv) => Promise<PassportUsageResponse>;
  env: NodeJS.ProcessEnv;
};

export const defaultSendDeps: SendDeps = {
  resolvePassportOrgId: async (twOrgId) => {
    const org = await withTwOrg(prisma, twOrgId, (tx) =>
      tx.organization.findUnique({ where: { id: twOrgId }, select: { identityMode: true, externalRef: true } })
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
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // keep raw text
    }
    return { status: res.status, body: parsed };
  },
  env: process.env,
};

/** Passport ReportUsageDto body: one overage reminder = value 1 on the period of the send, keyed by ref. */
export function toPassportUsageBody(payload: WaUsagePayload, passportOrgId: string) {
  return {
    organizationId: passportOrgId,
    meter: WA_USAGE_METER,
    period: payload.period,
    ref: payload.ref,
    value: 1,
    timestamp: payload.timestamp,
  };
}

/**
 * Task handler. Included reminders are ledger-only (return = done). Billable ones POST to Passport;
 * 2xx and 409 (identifier already held) are done, anything else throws so TaskProcessor retries.
 */
export async function sendWhatsappReminderUsage(rawPayload: string, deps: Partial<SendDeps> = {}): Promise<void> {
  const d = { ...defaultSendDeps, ...deps };
  const payload = waUsagePayloadSchema.parse(JSON.parse(rawPayload));
  if (!payload.billable) return;
  const passportOrgId = await d.resolvePassportOrgId(payload.twOrgId);
  if (!passportOrgId) throw new Error(`Timeway org ${payload.twOrgId} is not linked to a Passport organization`);
  const res = await d.postUsage(toPassportUsageBody(payload, passportOrgId), payload.idempotencyKey, d.env);
  if (res.status >= 200 && res.status < 300) return;
  if (res.status === 409) {
    log.warn("WhatsApp reminder usage already recorded", safeStringify({ key: payload.idempotencyKey }));
    return;
  }
  const detail = (typeof res.body === "string" ? res.body : JSON.stringify(res.body ?? null)).slice(0, 300);
  throw new Error(`Passport /v1/usage answered ${res.status} for ${payload.idempotencyKey}: ${detail}`);
}
