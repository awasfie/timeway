import process from "node:process";
import logger from "@calcom/lib/logger";
import { safeStringify } from "@calcom/lib/safeStringify";
import prisma from "@calcom/prisma";
import { Prisma } from "@calcom/prisma/client";
import { withTwPlatform } from "@calcom/prisma/tw-org-context";
import type { TwBillingAttributionValue } from "@calcom/prisma/tw-sub-org";
import { isUnbilled, resolveBillingOrg } from "@calcom/prisma/tw-sub-org";
import { z } from "zod";
import type { SendDeps } from "./platformFee";
import { defaultSendDeps } from "./platformFee";

/**
 * WC-TW-14c (E6, E5, E7, E8). Embedded-API usage meters reported to Passport POST /v1/usage:
 *  (a) timeway_api_managed_user: ONE daily snapshot per billing org (aggregation `last`), value =
 *      managed=true members summed over the billing org and every client org that bills to it,
 *      ref mu:<billingOrgId>, no clientOrgId (Gosi decision on this card, passport#42).
 *  (b) timeway_api_booking: 1 per booking created through API v2 / platform OAuth for a managed
 *      member, ref bk:<bookingUid>, clientOrgId = originating org. Cancellations never reverse it.
 * Raw counts only. Prices and free tiers live in PART CM / Passport, never here (grep test).
 *
 * Delivery reuses the Tasker outbox (Task table), deduplicated by the (referenceUid, type) unique
 * index, retried with exponential backoff. Enqueue errors are logged and swallowed: Passport never
 * blocks provisioning or booking.
 */

const log = logger.getSubLogger({ prefix: ["payment-gateway:api-usage"] });

export const API_USAGE_TASK = "timewayApiUsage" as const;
export const API_USAGE_PRODUCT = "TIMEWAY" as const;
export const API_USAGE_MANAGED_USER_METER = "timeway_api_managed_user" as const;
export const API_USAGE_BOOKING_METER = "timeway_api_booking" as const;
export const API_USAGE_FLAG = "TW_API_USAGE_ENABLED" as const;
export const API_USAGE_MAX_ATTEMPTS = 12;

const BOOKING_REF_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const apiUsagePayloadSchema = z.object({
  idempotencyKey: z.string().min(1),
  product: z.literal(API_USAGE_PRODUCT),
  meter: z.enum([API_USAGE_MANAGED_USER_METER, API_USAGE_BOOKING_METER]),
  /** Passport `ref` (<kind>:<id>); with the period it is the line's natural key. */
  ref: z.string().regex(/^[a-z]{2}:[A-Za-z0-9_-]{1,64}$/),
  /** YYYY-MM-DD for the daily snapshot, YYYY-MM for the booking line. */
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/),
  value: z.number().int().min(0),
  /** Billing org (tw_organization.id); Passport's org id is resolved at send time. */
  billingOrgId: z.string().uuid(),
  /** Originating org; booking meter only. */
  clientOrgId: z.string().uuid().optional(),
  /** Unix seconds, stored with the line and re-sent as-is so a retry is a replay. */
  timestamp: z.number().int().nonnegative(),
});

export type ApiUsagePayload = z.infer<typeof apiUsagePayloadSchema>;

export function isApiUsageEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[API_USAGE_FLAG] === "true";
}

function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

function utcMonth(at: Date): string {
  return at.toISOString().slice(0, 7);
}

export type EnqueueOutcome = "disabled" | "duplicate" | "enqueued" | "error";

type CreateTask = (payload: ApiUsagePayload, referenceUid: string) => Promise<unknown>;

const defaultCreateTask: CreateTask = async (payload, referenceUid) => {
  const { default: tasker } = await import("@calcom/features/tasker");
  return tasker.create(API_USAGE_TASK, payload, { referenceUid, maxAttempts: API_USAGE_MAX_ATTEMPTS });
};

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

async function enqueueLine(
  payload: ApiUsagePayload,
  createTask: CreateTask
): Promise<Exclude<EnqueueOutcome, "disabled" | "error">> {
  try {
    await createTask(payload, payload.idempotencyKey);
  } catch (error) {
    if (isUniqueViolation(error)) return "duplicate";
    throw error;
  }
  return "enqueued";
}

export type OrgRow = {
  id: string;
  parentOrgId: string | null;
  billingAttribution: TwBillingAttributionValue;
  isSandbox: boolean;
  managedMembers: number;
};

export type SnapshotResult = {
  enabled: boolean;
  day: string;
  billingOrgs: number;
  enqueued: number;
  duplicate: number;
  errors: number;
};

type SnapshotDeps = {
  loadOrgs: () => Promise<OrgRow[]>;
  createTask: CreateTask;
  now: () => Date;
  env: NodeJS.ProcessEnv;
};

const defaultSnapshotDeps: SnapshotDeps = {
  loadOrgs: () =>
    withTwPlatform(prisma, "wc-tw-14c managed-user snapshot (cross-org sum per billing org)", async (tx) => {
      const orgs = await tx.organization.findMany({
        select: { id: true, parentOrgId: true, billingAttribution: true, isSandbox: true },
      });
      const counts = await tx.organizationMember.groupBy({
        by: ["orgId"],
        where: { managed: true },
        _count: { _all: true },
      });
      const byOrg = new Map(counts.map((c) => [c.orgId, c._count._all]));
      return orgs.map((o) => ({ ...o, managedMembers: byOrg.get(o.id) ?? 0 }));
    }),
  createTask: defaultCreateTask,
  now: () => new Date(),
  env: process.env,
};

/**
 * Daily snapshot. Sandbox exclusion (E7) is applied before summing; the sum is keyed by the billing
 * org (E5). The identifier depends only on (UTC day, billing org), so a second run the same day
 * enqueues nothing new. Orgs with zero managed users emit no line.
 */
export async function enqueueManagedUserSnapshot(deps: Partial<SnapshotDeps> = {}): Promise<SnapshotResult> {
  const d = { ...defaultSnapshotDeps, ...deps };
  const at = d.now();
  const day = utcDay(at);
  const result: SnapshotResult = {
    enabled: isApiUsageEnabled(d.env),
    day,
    billingOrgs: 0,
    enqueued: 0,
    duplicate: 0,
    errors: 0,
  };
  if (!result.enabled) return result;

  let orgs: OrgRow[];
  try {
    orgs = await d.loadOrgs();
  } catch (error) {
    log.error("Managed-user snapshot could not load orgs", safeStringify({ error }));
    result.errors += 1;
    return result;
  }

  const byId = new Map(orgs.map((o) => [o.id, o]));
  const totals = new Map<string, number>();
  for (const org of orgs) {
    if (org.managedMembers <= 0) continue;
    const parent = org.parentOrgId ? (byId.get(org.parentOrgId) ?? null) : null;
    if (org.parentOrgId && !parent) {
      log.warn("Org has a parent that was not loaded; skipped", safeStringify({ orgId: org.id }));
      result.errors += 1;
      continue;
    }
    if (isUnbilled(org, parent)) continue;
    const billingOrgId = resolveBillingOrg(org);
    totals.set(billingOrgId, (totals.get(billingOrgId) ?? 0) + org.managedMembers);
  }

  const timestamp = Math.floor(at.getTime() / 1000);
  for (const [billingOrgId, value] of totals) {
    result.billingOrgs += 1;
    const ref = `mu:${billingOrgId}`;
    try {
      const payload = apiUsagePayloadSchema.parse({
        idempotencyKey: `tw-api:${API_USAGE_MANAGED_USER_METER}:${day}:${ref}`,
        product: API_USAGE_PRODUCT,
        meter: API_USAGE_MANAGED_USER_METER,
        ref,
        period: day,
        value,
        billingOrgId,
        timestamp,
      });
      const outcome = await enqueueLine(payload, d.createTask);
      if (outcome === "enqueued") result.enqueued += 1;
      else result.duplicate += 1;
    } catch (error) {
      log.error("Managed-user snapshot enqueue failed", safeStringify({ billingOrgId, error }));
      result.errors += 1;
    }
  }
  return result;
}

export type ApiBookingFacts = {
  uid: string;
  twOrgId: string | null;
  creationSource: string | null;
  viaPlatformOAuth: boolean;
  /** Organizer is a managed=true member of twOrgId. */
  organizerManaged: boolean;
  org: Pick<OrgRow, "id" | "parentOrgId" | "billingAttribution" | "isSandbox"> | null;
  parent: Pick<OrgRow, "id" | "isSandbox"> | null;
};

export type BookingOutcome =
  | EnqueueOutcome
  | "not_api"
  | "no_org"
  | "not_managed"
  | "unbilled"
  | "booking_not_found"
  | "bad_uid";

type BookingDeps = {
  loadFacts: (bookingUid: string) => Promise<ApiBookingFacts | null>;
  createTask: CreateTask;
  now: () => Date;
  env: NodeJS.ProcessEnv;
};

const defaultBookingDeps: BookingDeps = {
  loadFacts: (bookingUid) =>
    withTwPlatform(
      prisma,
      "wc-tw-14c api-booking usage line (org, parent and organizer membership)",
      async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { uid: bookingUid },
          select: { uid: true, twOrgId: true, userId: true, creationSource: true },
        });
        if (!booking) return null;
        const orgSelect = { id: true, parentOrgId: true, billingAttribution: true, isSandbox: true } as const;
        const org = booking.twOrgId
          ? await tx.organization.findUnique({ where: { id: booking.twOrgId }, select: orgSelect })
          : null;
        const parent = org?.parentOrgId
          ? await tx.organization.findUnique({
              where: { id: org.parentOrgId },
              select: { id: true, isSandbox: true },
            })
          : null;
        const member =
          org && booking.userId
            ? await tx.organizationMember.findUnique({
                where: { orgId_userId: { orgId: org.id, userId: booking.userId } },
                select: { managed: true },
              })
            : null;
        return {
          uid: booking.uid,
          twOrgId: booking.twOrgId,
          creationSource: booking.creationSource,
          viaPlatformOAuth: false,
          organizerManaged: member?.managed === true,
          org,
          parent,
        };
      }
    ),
  createTask: defaultCreateTask,
  now: () => new Date(),
  env: process.env,
};

/**
 * Enqueue the booking line (b). Idempotent per booking uid: the Task referenceUid is the identifier,
 * so a repeated create path adds nothing. Call once, from the booking-create path only (never for a
 * reschedule, which would count the same booking twice). Never throws.
 */
export async function enqueueApiBookingUsage(
  input: { bookingUid: string; viaPlatformOAuth?: boolean },
  deps: Partial<BookingDeps> = {}
): Promise<BookingOutcome> {
  const d = { ...defaultBookingDeps, ...deps };
  if (!isApiUsageEnabled(d.env)) return "disabled";
  try {
    if (!BOOKING_REF_ID.test(input.bookingUid)) return "bad_uid";
    const facts = await d.loadFacts(input.bookingUid);
    if (!facts) return "booking_not_found";
    const viaApi =
      facts.creationSource === "API_V2" || facts.viaPlatformOAuth || input.viaPlatformOAuth === true;
    if (!viaApi) return "not_api";
    if (!facts.org || !facts.twOrgId) return "no_org";
    if (!facts.organizerManaged) return "not_managed";
    if (isUnbilled(facts.org, facts.parent)) return "unbilled";

    const at = d.now();
    const period = utcMonth(at);
    const ref = `bk:${facts.uid}`;
    const payload = apiUsagePayloadSchema.parse({
      idempotencyKey: `tw-api:${API_USAGE_BOOKING_METER}:${ref}`,
      product: API_USAGE_PRODUCT,
      meter: API_USAGE_BOOKING_METER,
      ref,
      period,
      value: 1,
      billingOrgId: resolveBillingOrg(facts.org),
      clientOrgId: facts.org.id,
      timestamp: Math.floor(at.getTime() / 1000),
    });
    return await enqueueLine(payload, d.createTask);
  } catch (error) {
    log.error("API booking usage enqueue failed", safeStringify({ bookingUid: input.bookingUid, error }));
    return "error";
  }
}

/** Body for Passport POST /v1/usage; Passport rejects unknown fields and clientOrgId on a `last` meter. */
export function toPassportApiUsageBody(
  payload: ApiUsagePayload,
  passportOrgId: string,
  passportClientOrgId: string | null
) {
  return {
    organizationId: passportOrgId,
    meter: payload.meter,
    period: payload.period,
    ref: payload.ref,
    value: payload.value,
    timestamp: payload.timestamp,
    ...(payload.meter === API_USAGE_BOOKING_METER && passportClientOrgId
      ? { clientOrgId: passportClientOrgId }
      : {}),
  };
}

/**
 * Task handler. Throwing retries on the tasksConfig backoff. 2xx and 409 (identifier already held)
 * are sent; everything else (5xx, 4xx, network, org not linked yet) retries so the line stays visible
 * in the Task table until it lands or exhausts its attempts.
 */
export async function sendApiUsage(rawPayload: string, deps: Partial<SendDeps> = {}): Promise<void> {
  const d = { ...defaultSendDeps, ...deps };
  const payload = apiUsagePayloadSchema.parse(JSON.parse(rawPayload));
  const passportOrgId = await d.resolvePassportOrgId(payload.billingOrgId);
  if (!passportOrgId) {
    throw new Error(`Timeway org ${payload.billingOrgId} is not linked to a Passport organization`);
  }
  // A client org that is not linked yet only loses the itemization, never the billed line.
  const passportClientOrgId = payload.clientOrgId
    ? payload.clientOrgId === payload.billingOrgId
      ? passportOrgId
      : await d.resolvePassportOrgId(payload.clientOrgId)
    : null;
  const res = await d.postUsage(
    toPassportApiUsageBody(payload, passportOrgId, passportClientOrgId),
    payload.idempotencyKey,
    d.env
  );
  if (res.status >= 200 && res.status < 300) {
    log.info("API usage sent", safeStringify({ key: payload.idempotencyKey, status: res.status }));
    return;
  }
  if (res.status === 409) {
    log.warn("API usage already recorded", safeStringify({ key: payload.idempotencyKey }));
    return;
  }
  const detail = (typeof res.body === "string" ? res.body : JSON.stringify(res.body ?? null)).slice(0, 300);
  throw new Error(`Passport /v1/usage answered ${res.status} for ${payload.idempotencyKey}: ${detail}`);
}
