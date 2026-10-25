/**
 * WC-TW-9b — activation ledger hooks (Bible WC-9 step 2).
 *
 * An org is activated when it has calendar_connected, event_type_published and
 * first_external_booking within 7 days of tw_organization.createdAt
 * (scripts/activation.ts reports it). tw_activation_event holds the FIRST
 * occurrence of each kind per org: inserts are ON CONFLICT DO NOTHING.
 *
 * Every hook runs after the user's write has committed and never throws: a
 * ledger or Plausible failure is logged and the user action carries on.
 * Org ids come from server-side rows (credential owner, event type, booking),
 * never from request input, so withTwOrg's provenance contract holds.
 */
import { randomUUID } from "node:crypto";

import logger from "@calcom/lib/logger";
import { trackServerEvent } from "@calcom/lib/trackServerEvent";
import { prisma } from "@calcom/prisma";
import type { RawCapableTx, TxCapableClient } from "@calcom/prisma/tw-org-context";
import { withTwOrg } from "@calcom/prisma/tw-org-context";

const log = logger.getSubLogger({ prefix: ["tw-activation"] });

export type ActivationKind = "calendar_connected" | "event_type_published" | "first_external_booking";

export interface ActivationTx extends RawCapableTx {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}
export type ActivationClient = TxCapableClient<ActivationTx> & {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
};

// The Prisma client satisfies the structural shape; the cast keeps generated types out of this module's API.
const defaultClient = prisma as unknown as ActivationClient;

const normEmail = (e: string) => e.trim().toLowerCase();

/**
 * External = at least one attendee, and no attendee email belongs to a member
 * of the booking's org (a booking among colleagues is not activation).
 */
export function isExternalBooking(attendeeEmails: readonly string[], memberEmails: readonly string[]): boolean {
  const attendees = attendeeEmails.filter((e) => e && e.trim()).map(normEmail);
  if (attendees.length === 0) return false;
  const members = new Set(memberEmails.filter(Boolean).map(normEmail));
  return attendees.every((e) => !members.has(e));
}

export const isCalendarCredentialType = (type: string | null | undefined): boolean =>
  !!type && type.endsWith("_calendar");

/** First-wins insert inside an org-scoped transaction. Returns true when this call created the row. */
export async function insertActivationEvent(
  tx: ActivationTx,
  ev: { twOrgId: string; kind: ActivationKind; occurredAt: Date; refId: string | null }
): Promise<boolean> {
  const inserted = await tx.$executeRaw`
    INSERT INTO "tw_activation_event" ("id", "twOrgId", "kind", "occurredAt", "refId")
    VALUES (${randomUUID()}::uuid, ${ev.twOrgId}::uuid, ${ev.kind}::"TwActivationKind", ${ev.occurredAt}, ${ev.refId})
    ON CONFLICT ("twOrgId", "kind") DO NOTHING`;
  return inserted === 1;
}

export async function recordActivationEvent(
  ev: { twOrgId: string; kind: ActivationKind; occurredAt?: Date; refId?: string | number | null },
  client: ActivationClient = defaultClient
): Promise<boolean> {
  return withTwOrg(client, ev.twOrgId, (tx) =>
    insertActivationEvent(tx, {
      twOrgId: ev.twOrgId,
      kind: ev.kind,
      occurredAt: ev.occurredAt ?? new Date(),
      refId: ev.refId == null ? null : String(ev.refId),
    })
  );
}

/** users.twOrgId (TW-T9 backfill / provisioning). The users table is not under RLS. */
async function resolveUserTwOrgId(userId: number, client: ActivationClient): Promise<string | null> {
  const rows = await client.$queryRaw<{ twOrgId: string | null }[]>`
    SELECT "twOrgId"::text AS "twOrgId" FROM "users" WHERE "id" = ${userId}`;
  return rows[0]?.twOrgId ?? null;
}

function logFailure(hook: string, err: unknown) {
  log.warn(`${hook} failed (user action unaffected): ${(err as Error)?.message ?? String(err)}`);
}

export async function onCalendarCredentialCreated(
  credential: { id: number; type: string; userId?: number | null; twOrgId?: string | null },
  source: string,
  client: ActivationClient = defaultClient
): Promise<void> {
  try {
    if (!isCalendarCredentialType(credential.type)) return;
    const twOrgId =
      credential.twOrgId ?? (credential.userId ? await resolveUserTwOrgId(credential.userId, client) : null);
    trackServerEvent("calendar_connected", { org: twOrgId, source: `${source}:${credential.type}` });
    if (!twOrgId) return;
    await recordActivationEvent({ twOrgId, kind: "calendar_connected", refId: credential.id }, client);
  } catch (err) {
    logFailure("onCalendarCredentialCreated", err);
  }
}

export async function onEventTypeVisible(
  eventType: { id: number; twOrgId?: string | null; userId?: number | null },
  source: "create" | "update",
  client: ActivationClient = defaultClient
): Promise<void> {
  try {
    const twOrgId =
      eventType.twOrgId ?? (eventType.userId ? await resolveUserTwOrgId(eventType.userId, client) : null);
    trackServerEvent("event_type_published", { org: twOrgId, event_type: eventType.id, source });
    if (!twOrgId) return;
    await recordActivationEvent({ twOrgId, kind: "event_type_published", refId: eventType.id }, client);
  } catch (err) {
    logFailure("onEventTypeVisible", err);
  }
}

export async function onBookingCreated(
  booking: {
    uid: string;
    status: string;
    twOrgId?: string | null;
    eventTypeId?: number | null;
    attendees?: { email: string }[];
  },
  source: string,
  client: ActivationClient = defaultClient
): Promise<void> {
  try {
    if (booking.status !== "ACCEPTED") return;
    const twOrgId = booking.twOrgId ?? null;
    trackServerEvent("booking_confirmed", { org: twOrgId, event_type: booking.eventTypeId, source });
    if (!twOrgId) return;
    const attendeeEmails = (booking.attendees ?? []).map((a) => a.email);
    const created = await withTwOrg(client, twOrgId, async (tx) => {
      const existing = await tx.$queryRaw<{ one: number }[]>`
        SELECT 1 AS one FROM "tw_activation_event"
        WHERE "twOrgId" = ${twOrgId}::uuid AND "kind" = 'first_external_booking'::"TwActivationKind"`;
      if (existing.length > 0) return false;
      const members = await tx.$queryRaw<{ email: string }[]>`
        SELECT u."email" FROM "tw_organization_member" m JOIN "users" u ON u."id" = m."userId"
        WHERE m."orgId" = ${twOrgId}::uuid`;
      if (!isExternalBooking(attendeeEmails, members.map((m) => m.email))) return false;
      return insertActivationEvent(tx, {
        twOrgId,
        kind: "first_external_booking",
        occurredAt: new Date(),
        refId: booking.uid,
      });
    });
    if (created) {
      trackServerEvent("first_external_booking", { org: twOrgId, event_type: booking.eventTypeId, source });
    }
  } catch (err) {
    logFailure("onBookingCreated", err);
  }
}
