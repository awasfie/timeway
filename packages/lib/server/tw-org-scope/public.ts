/**
 * TW-T9.2b2 — org scope for public (unauthenticated) booking entry points.
 *
 * A public request has no session, so the org comes from the public identifier in
 * the URL or body (username, team slug, booking uid), resolved by the SECURITY
 * DEFINER functions from TW-T9.2a. Never from an orgId / orgSlug param (CC-13).
 *
 * Rule: every key must resolve to exactly one distinct non-NULL twOrgId and all keys
 * to the same one. Anything else (no row, NULL-only, two orgs) is not found. There is
 * no platform fallback on a public path.
 */

import logger from "@calcom/lib/logger";
import { runWithTwOrg } from "@calcom/prisma/tw-org-context";
import { HttpError } from "../../http-error";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const log = logger.getSubLogger({ prefix: ["tw-org-scope:public"] });

type RawQueryClient = {
  $queryRaw(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<unknown>;
};

export type TwPublicResolver = "user_slug" | "team_slug" | "booking_uid" | "seat_reference" | "event_type_id";

export type TwPublicLookup = { resolver: TwPublicResolver; keys: readonly string[] };

type ResolverRow = { id: number; twOrgId: string | null };

function queryResolver(
  client: RawQueryClient,
  resolver: TwPublicResolver,
  key: string
): PromiseLike<unknown> {
  switch (resolver) {
    case "user_slug":
      return client.$queryRaw`
        select id, "twOrgId" from public.tw_resolve_org_for_user_slug(${key})`;
    case "team_slug":
      return client.$queryRaw`
        select id, "twOrgId" from public.tw_resolve_org_for_team_slug(${key})`;
    case "booking_uid":
      return client.$queryRaw`
        select id, "twOrgId" from public.tw_resolve_org_for_booking_uid(${key})`;
    case "seat_reference":
      return client.$queryRaw`
        select id, "twOrgId" from public.tw_resolve_org_for_seat_reference(${key})`;
    case "event_type_id": {
      // A key that is not a positive int32 never reaches SQL: it resolves to no row.
      const id = Number(key);
      if (!/^[1-9][0-9]*$/.test(key) || id > 2147483647) return Promise.resolve([]);
      return client.$queryRaw`
        select id, "twOrgId" from public.tw_resolve_org_for_event_type_id(${id}::int)`;
    }
  }
}

function orgsOf(rows: unknown): Set<string> {
  const orgs = new Set<string>();
  for (const row of Array.isArray(rows) ? (rows as ResolverRow[]) : []) {
    if (typeof row.twOrgId === "string" && UUID_RE.test(row.twOrgId)) orgs.add(row.twOrgId.toLowerCase());
  }
  return orgs;
}

/** The single org every key resolves to, or null (logged with the keys and the count). */
export async function resolvePublicTwOrg(
  client: RawQueryClient,
  lookup: TwPublicLookup | null
): Promise<string | null> {
  const keys = Array.from(new Set((lookup?.keys ?? []).filter((k) => typeof k === "string" && k.length > 0)));
  if (!lookup || keys.length === 0) {
    log.warn("public org not resolved", { resolver: lookup?.resolver ?? null, keys: [], count: 0 });
    return null;
  }
  const all = new Set<string>();
  for (const key of keys) {
    const orgs = orgsOf(await queryResolver(client, lookup.resolver, key));
    if (orgs.size !== 1) {
      log.warn("public org not resolved", { resolver: lookup.resolver, key, count: orgs.size });
      return null;
    }
    orgs.forEach((o) => all.add(o));
  }
  if (all.size !== 1) {
    log.warn("public org not resolved", { resolver: lookup.resolver, keys, count: all.size });
    return null;
  }
  return Array.from(all)[0];
}

/** First lookup that resolves wins (e.g. a booking body's `user` is a username or a team slug). */
export async function resolvePublicTwOrgFirst(
  client: RawQueryClient,
  lookups: readonly (TwPublicLookup | null)[]
): Promise<string | null> {
  for (const lookup of lookups) {
    if (!lookup || lookup.keys.length === 0) continue;
    const org = await resolvePublicTwOrg(client, lookup);
    if (org) return org;
  }
  return null;
}

export class TwPublicOrgNotFoundError extends HttpError<404> {
  constructor() {
    super({ statusCode: 404, message: "Not found" });
    Object.setPrototypeOf(this, TwPublicOrgNotFoundError.prototype);
    this.name = "TwPublicOrgNotFoundError";
  }
}

/** API routes: run `fn` in the resolved org, else throw a 404 HttpError. */
export async function runWithPublicTwOrg<R>(
  client: RawQueryClient,
  lookups: TwPublicLookup | null | readonly (TwPublicLookup | null)[],
  fn: () => R | PromiseLike<R>
): Promise<R> {
  const list = Array.isArray(lookups) ? lookups : [lookups as TwPublicLookup | null];
  const org = await resolvePublicTwOrgFirst(client, list);
  if (!org) throw new TwPublicOrgNotFoundError();
  return runWithTwOrg(org, fn);
}

/** getServerSideProps: run in the resolved org, else `{ notFound: true }`. */
export async function runSsrWithPublicTwOrg<R>(
  client: RawQueryClient,
  lookups: TwPublicLookup | null | readonly (TwPublicLookup | null)[],
  fn: () => R | PromiseLike<R>
): Promise<R | { notFound: true }> {
  const list = Array.isArray(lookups) ? lookups : [lookups as TwPublicLookup | null];
  const org = await resolvePublicTwOrgFirst(client, list);
  if (!org) return { notFound: true } as const;
  return runWithTwOrg(org, fn);
}

function asList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  return [];
}

/**
 * Booking create body (`/api/book/event`, recurring): the booker sends `user` = the
 * username(s) of a user event or the team slug of a team event. orgId / orgSlug in the
 * body are ignored.
 */
export function publicLookupsForBookingBody(body: unknown): TwPublicLookup[] {
  const record = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const users = asList(record.user)
    .flatMap((u) => u.split("+"))
    .filter(Boolean);
  if (users.length === 0) return [];
  const lookups: TwPublicLookup[] = [{ resolver: "user_slug", keys: users }];
  if (users.length === 1) lookups.push({ resolver: "team_slug", keys: users });
  return lookups;
}

/**
 * Booking pages accept a booking uid or a seat referenceUid. BookingSeat carries no
 * twOrgId and the seat -> booking join is empty for timeway_app under RLS, so a seat
 * reference goes through its own definer function (the org of the seat's booking).
 */
export function publicLookupsForBookingUid(uid: string | null | undefined): TwPublicLookup[] {
  if (!uid) return [];
  return [
    { resolver: "booking_uid", keys: [uid] },
    { resolver: "seat_reference", keys: [uid] },
  ];
}

/** Slot procedures (reserveSlot, isAvailable, removeSelectedSlotMark) carry an eventTypeId only. */
export function publicLookupForEventTypeIds(
  ids: readonly (number | null | undefined)[]
): TwPublicLookup | null {
  const keys = ids.filter((id): id is number => typeof id === "number" && Number.isInteger(id)).map(String);
  return keys.length === 0 ? null : { resolver: "event_type_id", keys };
}

/** slots.getSchedule: usernameList is team slug when isTeamEvent; orgSlug is ignored. */
export function publicLookupForSchedule(input: {
  usernameList?: string[] | null;
  isTeamEvent?: boolean | null;
}): TwPublicLookup | null {
  const keys = (input.usernameList ?? []).filter(Boolean);
  if (keys.length === 0) return null;
  return input.isTeamEvent
    ? { resolver: "team_slug", keys: keys.slice(0, 1) }
    : { resolver: "user_slug", keys };
}
