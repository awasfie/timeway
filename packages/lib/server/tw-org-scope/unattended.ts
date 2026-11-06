/**
 * TW-T9.2b3: org scope for unattended entry points (crons, calendar webhooks,
 * payment and app webhooks).
 *
 * Nobody is signed in on these paths, so the org comes from one of two places:
 *   1. the row the event names, resolved through the SECURITY DEFINER functions from
 *      TW-T9.2a (`tw_resolve_org_for_credential`, `tw_resolve_org_for_booking_uid`);
 *   2. a named platform scope for jobs that span orgs or events that name no such row.
 * An org id carried in a payload, header or query string is never read (CC-13).
 *
 * Every platform reason used by a call site is listed in TW_UNATTENDED_PLATFORM_REASONS,
 * so the list in the PR body and the entry-point audit (TW-T9.2b4) can be checked
 * against code.
 */

import logger from "@calcom/lib/logger";
import { runWithTwOrg, runWithTwPlatform } from "@calcom/prisma/tw-org-context";

const log = logger.getSubLogger({ prefix: ["tw-org-scope:unattended"] });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RawQueryClient = {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
};

function orgOf(rows: { twOrgId?: unknown }[] | null | undefined): string | null {
  const value = rows?.[0]?.twOrgId;
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

export const TW_UNATTENDED_PLATFORM_REASONS = [
  // apps/web/app/api/cron/<dir>
  "bookingReminder",
  "calendar-subscriptions",
  "calendar-subscriptions-cleanup",
  "changeTimeZone",
  "selected-calendars",
  "syncAppMeta",
  "webhookTriggers",
  // apps/web/app/api/tasks/<dir> (tasker: scheduled webhooks, reminders, workflow tasks)
  "tasks-cron",
  "tasks-cleanup",
  // webhooks whose event names no booking uid or credential id
  "app-credential-webhook",
  "alby-webhook",
  "btcpayserver-webhook",
  "hitpay-webhook",
  "paypal-webhook",
  "vital-webhook",
] as const;

export type TwUnattendedPlatformReason = (typeof TW_UNATTENDED_PLATFORM_REASONS)[number];

/** Wraps a cron or webhook handler so everything it does runs under the named platform scope. */
export function withTwPlatformJob<Args extends unknown[], R>(
  reason: TwUnattendedPlatformReason,
  handler: (...args: Args) => R | PromiseLike<R>
): (...args: Args) => Promise<R> {
  if (!(TW_UNATTENDED_PLATFORM_REASONS as readonly string[]).includes(reason)) {
    throw new Error(`TW-T9: unlisted platform reason "${reason}"`);
  }
  return (...args: Args) => runWithTwPlatform(reason, () => handler(...args));
}

/** Org of a Credential row, read through the definer function; null when unknown or NULL. */
export async function resolveTwOrgForCredential(
  client: RawQueryClient,
  credentialId: number | null | undefined
): Promise<string | null> {
  if (typeof credentialId !== "number" || !Number.isInteger(credentialId)) return null;
  const rows = await client.$queryRaw<{ id: number; twOrgId: string | null }[]>`
    select id, "twOrgId" from public.tw_resolve_org_for_credential(${credentialId}::integer)`;
  return orgOf(rows);
}

/** Org of a Booking row by uid, read through the definer function; null when unknown or NULL. */
export async function resolveTwOrgForBookingUid(
  client: RawQueryClient,
  uid: string | null | undefined
): Promise<string | null> {
  if (typeof uid !== "string" || !uid) return null;
  const rows = await client.$queryRaw<{ id: number; twOrgId: string | null }[]>`
    select id, "twOrgId" from public.tw_resolve_org_for_booking_uid(${uid})`;
  return orgOf(rows);
}

export type TwScopedOutcome<R> = { ran: true; value: R } | { ran: false; reason: "org-unresolved" };

/**
 * Runs `fn` in the resolved org. A NULL or unresolvable org runs nothing: there is no
 * platform fallback, the caller acknowledges the event and does no work.
 */
export async function runInResolvedTwOrg<R>(
  orgId: string | null,
  fn: () => R | PromiseLike<R>
): Promise<TwScopedOutcome<R>> {
  if (!orgId) return { ran: false, reason: "org-unresolved" };
  return { ran: true, value: await runWithTwOrg(orgId, fn) };
}

/** The SelectedCalendar fields the calendar webhook uses; SelectedCalendar is not RLS'd. */
export type SelectedCalendarRef = { id: string; credentialId: number | null };

export interface SelectedCalendarTwOrgScope {
  run<R>(selectedCalendar: SelectedCalendarRef, fn: () => R | PromiseLike<R>): Promise<TwScopedOutcome<R>>;
}

/**
 * Calendar webhooks (Google channel, Graph subscription): channel id -> SelectedCalendar
 * -> credentialId -> tw_resolve_org_for_credential -> org scope. Calendars without a
 * stored credential (delegation-only) or whose credential has no org are skipped and
 * logged, so the provider gets its 200 and does not retry.
 */
export function selectedCalendarTwOrgScope(client: RawQueryClient): SelectedCalendarTwOrgScope {
  return {
    async run(selectedCalendar, fn) {
      const orgId = await resolveTwOrgForCredential(client, selectedCalendar.credentialId);
      const outcome = await runInResolvedTwOrg(orgId, fn);
      if (!outcome.ran) {
        log.warn("calendar webhook skipped: no org for selected calendar", {
          selectedCalendarId: selectedCalendar.id,
          credentialId: selectedCalendar.credentialId,
        });
      }
      return outcome;
    },
  };
}
