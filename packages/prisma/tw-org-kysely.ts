/**
 * t_1952224a — org scope for the Kysely pools (packages/kysely, API v2 KyselyRead/WriteService).
 *
 * Those pools are plain `pg` pools, not the Prisma client, so the TW-T9.2a extension never
 * runs for them and, under FORCE RLS (TW-T9.2d), every Booking/users/EventType read returns
 * zero rows (bookings/get showed "No upcoming bookings" for every tenant).
 *
 * Kysely calls `onReserveConnection` each time a connection is taken from the pool, in the
 * caller's async context, before the query or `begin`. The hook writes the current scope
 * (tw-org-context.ts ALS) as SESSION settings on that connection, and writes empty values
 * when there is no scope. Every reservation overwrites both settings, so a previous
 * request's org can never survive on a reused connection; no scope stays fail-closed
 * (the policies read NULLIF(current_setting('app.tw_org_id', true), '')).
 *
 * Kept free of a `kysely` import: callers pass `CompiledQuery.raw` from their own copy.
 */
import { getTwOrgContext } from "./tw-org-context";

export const TW_ORG_KYSELY_SQL =
  "select set_config('app.tw_org_id', $1, false), set_config('app.tw_platform', $2, false)";

/** Session values for the current scope: [orgId, platform], empty strings when unscoped. */
export function twOrgKyselyParams(): [string, string] {
  const ctx = getTwOrgContext();
  if (!ctx) return ["", ""];
  return ctx.kind === "org" ? [ctx.orgId, ""] : ["", "on"];
}

type Connection<Q> = { executeQuery(query: Q): Promise<unknown> };

/** `onReserveConnection` for a Kysely PostgresDialect: `twOrgKyselyOnReserve(CompiledQuery.raw)`. */
export function twOrgKyselyOnReserve<Q>(raw: (sql: string, parameters: unknown[]) => Q) {
  return async (connection: Connection<Q>): Promise<void> => {
    await connection.executeQuery(raw(TW_ORG_KYSELY_SQL, twOrgKyselyParams()));
  };
}
