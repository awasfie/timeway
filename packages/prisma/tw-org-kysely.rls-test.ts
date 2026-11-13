/**
 * t_1952224a: the production Kysely client (`@calcom/kysely`, used by bookings/get) under
 * FORCE RLS as timeway_app on a pool of one. Before the fix every read returned zero rows
 * because its pg pool never set app.tw_org_id ("No upcoming bookings" for every tenant).
 *   1. org A scope sees A's booking only, org B scope B's only (both the plain query and
 *      inside kysely.transaction());
 *   2. on the same backend, after an org A read, an unscoped read sees nothing and an
 *      org B read sees only B (the session setting never leaks across reservations);
 *   3. platform scope sees both.
 *
 * Env as in tw-rls-core-tables.rls-test.ts (CI `rls` job). Missing env FAILS the suite.
 */
import { randomUUID } from "node:crypto";
import process from "node:process";
import kysely from "@calcom/kysely";
import { sql } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTwOrg, runWithTwPlatform } from "./tw-org-context";

const ADMIN_URL = process.env.RLS_ADMIN_DATABASE_URL;

describe("t_1952224a Kysely bookings read under RLS (timeway_app, pool of one)", () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  const orgA = randomUUID();
  const orgB = randomUUID();
  const tag = randomUUID().slice(0, 8);
  const users: Record<"A" | "B", number> = { A: 0, B: 0 };
  const bookings: Record<"A" | "B", number> = { A: 0, B: 0 };

  const seen = async () => {
    const rows = await kysely
      .selectFrom("Booking")
      .select(["Booking.id", "Booking.userId"])
      .where("Booking.userId", "in", [users.A, users.B])
      .execute();
    return (["A", "B"] as const).filter((o) => rows.some((r) => r.id === bookings[o]));
  };
  const backend = async () => {
    const { rows } = await sql<{
      pid: number;
      org: string | null;
    }>`select pg_backend_pid() as pid, current_setting('app.tw_org_id', true) as org`.execute(kysely);
    return rows[0];
  };

  beforeAll(async () => {
    expect(ADMIN_URL, "RLS_ADMIN_DATABASE_URL must be set; this suite is never skipped").toBeTruthy();
    expect(process.env.DATABASE_POOL_MAX).toBe("1");
    await admin.connect();
    await admin.query("begin");
    await admin.query("select set_config('app.tw_platform', 'on', true)");
    await admin.query(
      `insert into tw_organization (id, slug, name, "updatedAt") values ($1, $2, 'A', now()), ($3, $4, 'B', now())`,
      [orgA, `k-a-${tag}`, orgB, `k-b-${tag}`]
    );
    for (const [o, org] of [
      ["A", orgA],
      ["B", orgB],
    ] as const) {
      const k = `${o.toLowerCase()}-${tag}`;
      users[o] = (
        await admin.query(
          `insert into users (email, username, uuid, "twOrgId") values ($1, $2, gen_random_uuid(), $3) returning id`,
          [`kysely-${k}@rls.invalid`, `kysely-${k}`, org]
        )
      ).rows[0].id;
      bookings[o] = (
        await admin.query(
          `insert into "Booking" (uid, title, "startTime", "endTime", "userId", "twOrgId")
           values ($1, 'x', now() + interval '1 day', now() + interval '1 day 30 minutes', $2, $3) returning id`,
          [`kysely-uid-${k}`, users[o], org]
        )
      ).rows[0].id;
    }
    await admin.query("commit");
  });

  afterAll(async () => {
    await admin.query("begin");
    await admin.query("select set_config('app.tw_platform', 'on', true)");
    await admin.query(`delete from "Booking" where "userId" = any($1)`, [Object.values(users)]);
    await admin.query(`delete from users where id = any($1)`, [Object.values(users)]);
    await admin.query(`delete from tw_organization where id in ($1, $2)`, [orgA, orgB]);
    await admin.query("commit");
    await admin.end();
    await kysely.destroy();
  });

  it("org A sees only A's booking, org B only B's; also inside kysely.transaction()", async () => {
    expect(await runWithTwOrg(orgA, seen)).toEqual(["A"]);
    expect(await runWithTwOrg(orgB, seen)).toEqual(["B"]);
    const inTx = await runWithTwOrg(orgA, () =>
      kysely
        .transaction()
        .execute(async (trx) =>
          trx
            .selectFrom("Booking")
            .select("Booking.id")
            .where("Booking.userId", "in", [users.A, users.B])
            .execute()
        )
    );
    expect(inTx.map((r) => r.id)).toEqual([bookings.A]);
  });

  it("the same backend forgets org A: unscoped sees nothing, org B sees only B", async () => {
    const a = await runWithTwOrg(orgA, backend);
    expect(a.org).toBe(orgA);
    const none = await backend();
    expect(none.pid).toBe(a.pid);
    expect(none.org ?? "").toBe("");
    expect(await seen()).toEqual([]);
    const b = await runWithTwOrg(orgB, async () => ({ who: await backend(), rows: await seen() }));
    expect(b.who.pid).toBe(a.pid);
    expect(b.rows).toEqual(["B"]);
  });

  it("platform scope sees both orgs' bookings", async () => {
    expect(await runWithTwPlatform("kysely rls spec", seen)).toEqual(["A", "B"]);
  });
});
