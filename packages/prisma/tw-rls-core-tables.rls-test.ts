/**
 * TW-T9.2d (WC-PE-6 timeway, proof CC-89 line): FORCE RLS on users, EventType, Booking,
 * Schedule and Credential, on the REAL pool as timeway_app (NOSUPERUSER NOBYPASSRLS, owns
 * nothing, DATABASE_POOL_MAX=1), through the production `prisma` client and its org-context
 * extension. For each of the five tables:
 *   1. org A scope sees exactly A's row (B's and the NULL-org row are invisible);
 *   2. released, the same backend sees 0 rows;
 *   3. an insert for org B under A, an update moving A's row to B, and an insert with no
 *      scope are rejected by RLS;
 *   4. the NULL-org row is invisible to every org scope and to no scope, visible only in a
 *      platform scope;
 *   5. an insert in A's scope that does not name twOrgId lands in A (column default).
 *
 * Env (CI `rls` job): DATABASE_URL = timeway_app, DATABASE_POOL_MAX=1,
 * RLS_ADMIN_DATABASE_URL = a role that may seed across orgs. Missing env FAILS the suite.
 */
import { randomUUID } from "node:crypto";
import process from "node:process";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./index";
import { runWithTwOrg, runWithTwPlatform } from "./tw-org-context";

const ADMIN_URL = process.env.RLS_ADMIN_DATABASE_URL;
const RLS_ERROR = /row-level security|42501/i;
const TABLES = ["users", "EventType", "Booking", "Schedule", "Credential"] as const;
type Table = (typeof TABLES)[number];
type Owner = "A" | "B" | "N";

describe("TW-T9.2d FORCE RLS on the five Cal.com tables (timeway_app, real pool)", () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  const orgA = randomUUID();
  const orgB = randomUUID();
  const tag = randomUUID().slice(0, 8);
  const org: Record<Owner, string | null> = { A: orgA, B: orgB, N: null };
  const ids = {} as Record<Table, Record<Owner, number>>;
  const created: { table: Table; id: number }[] = [];

  /** Rows of the seeded set visible to the current scope, per table, as owner letters. */
  const visible = async (): Promise<Record<Table, Owner[]>> => {
    const pick = (t: Table, rows: { id: number }[]) =>
      (Object.keys(ids[t]) as Owner[]).filter((o) => rows.some((r) => r.id === ids[t][o])).sort();
    const where = (t: Table) => ({ id: { in: Object.values(ids[t]) } });
    const sel = { id: true } as const;
    return {
      users: pick("users", await prisma.user.findMany({ where: where("users"), select: sel })),
      EventType: pick("EventType", await prisma.eventType.findMany({ where: where("EventType"), select: sel })),
      Booking: pick("Booking", await prisma.booking.findMany({ where: where("Booking"), select: sel })),
      Schedule: pick("Schedule", await prisma.schedule.findMany({ where: where("Schedule"), select: sel })),
      Credential: pick(
        "Credential",
        await prisma.credential.findMany({ where: where("Credential"), select: sel })
      ),
    };
  };
  const all = (o: Owner[]) => Object.fromEntries(TABLES.map((t) => [t, o]));

  beforeAll(async () => {
    expect(ADMIN_URL, "RLS_ADMIN_DATABASE_URL must be set; this suite is never skipped").toBeTruthy();
    expect(process.env.DATABASE_POOL_MAX).toBe("1");
    await admin.connect();
    await admin.query("begin");
    await admin.query("select set_config('app.tw_platform', 'on', true)");
    await admin.query(
      `insert into tw_organization (id, slug, name, "updatedAt") values ($1, $2, 'A', now()), ($3, $4, 'B', now())`,
      [orgA, `c-a-${tag}`, orgB, `c-b-${tag}`]
    );
    for (const t of TABLES) ids[t] = {} as Record<Owner, number>;
    for (const o of ["A", "B", "N"] as Owner[]) {
      const k = `${o.toLowerCase()}-${tag}`;
      const q1 = async (sql: string, params: unknown[]) => (await admin.query(sql, params)).rows[0].id as number;
      ids.users[o] = await q1(
        `insert into users (email, username, uuid, "twOrgId") values ($1, $2, gen_random_uuid(), $3) returning id`,
        [`core-${k}@rls.invalid`, `core-${k}`, org[o]]
      );
      ids.EventType[o] = await q1(
        `insert into "EventType" (title, slug, length, "userId", "twOrgId") values ('x', $1, 30, $2, $3) returning id`,
        [`core-et-${k}`, ids.users[o], org[o]]
      );
      ids.Booking[o] = await q1(
        `insert into "Booking" (uid, title, "startTime", "endTime", "userId", "twOrgId") values ($1, 'x', now(), now(), $2, $3) returning id`,
        [`core-uid-${k}`, ids.users[o], org[o]]
      );
      ids.Schedule[o] = await q1(
        `insert into "Schedule" ("userId", name, "twOrgId") values ($1, 'x', $2) returning id`,
        [ids.users[o], org[o]]
      );
      ids.Credential[o] = await q1(
        `insert into "Credential" (type, key, "userId", "twOrgId") values ('rls_core_test', '{}', $1, $2) returning id`,
        [ids.users[o], org[o]]
      );
    }
    await admin.query("commit");
  });

  afterAll(async () => {
    await admin.query("begin");
    await admin.query("select set_config('app.tw_platform', 'on', true)");
    const userIds = Object.values(ids.users ?? {});
    for (const c of created) await admin.query(`delete from "${c.table}" where id = $1`, [c.id]);
    await admin.query(`delete from "Credential" where "userId" = any($1)`, [userIds]);
    await admin.query(`delete from "Schedule" where "userId" = any($1)`, [userIds]);
    await admin.query(`delete from "Booking" where "userId" = any($1)`, [userIds]);
    await admin.query(`delete from "EventType" where "userId" = any($1)`, [userIds]);
    await admin.query(`delete from users where id = any($1)`, [userIds]);
    await admin.query(`delete from tw_organization where id in ($1, $2)`, [orgA, orgB]);
    await admin.query("commit");
    await admin.end();
    await prisma.$disconnect();
  });

  it("catalog: the five tables are ENABLE + FORCE with one NULLIF isolation policy and a SELECT-only owner policy", async () => {
    const { rows } = await admin.query(
      `select c.relname, c.relrowsecurity as rls, c.relforcerowsecurity as force,
              (select array_agg(p.polname::text order by p.polname) from pg_policy p where p.polrelid = c.oid) as pols
       from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname = any($1) order by c.relname`,
      [TABLES]
    );
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r).toMatchObject({ rls: true, force: true });
      expect(r.pols).toEqual([`${r.relname}_tw_org_isolation`, `${r.relname}_tw_owner_read`].sort());
    }
    const { rows: pols } = await admin.query(
      `select tablename, policyname, cmd, roles::text[] as roles, qual, with_check from pg_policies
       where schemaname = 'public' and tablename = any($1)`,
      [TABLES]
    );
    for (const p of pols) {
      if (p.policyname.endsWith("_tw_owner_read")) {
        expect(p).toMatchObject({ cmd: "SELECT", roles: ["timeway_owner"], qual: "true", with_check: null });
      } else {
        expect(p).toMatchObject({ cmd: "ALL", roles: ["public"] });
        for (const e of [p.qual, p.with_check]) expect(e).toMatch(/NULLIF\(current_setting\('app\.tw_org_id'/);
      }
    }
  });

  it("org A scope sees exactly A's row in each table; released, the same backend sees none", async () => {
    const seen = await runWithTwOrg(orgA, async () => {
      const [probe] = await prisma.$queryRaw<{ pid: number }[]>`select pg_backend_pid() as pid`;
      const interactive = await prisma.$transaction(async (tx) =>
        tx.booking.count({ where: { id: { in: Object.values(ids.Booking) } } })
      );
      return { pid: probe.pid, rows: await visible(), interactive };
    });
    expect(seen.rows).toEqual(all(["A"]));
    expect(seen.interactive).toBe(1);

    const [after] = await prisma.$queryRaw<{ pid: number; setting: string | null }[]>`
      select pg_backend_pid() as pid, current_setting('app.tw_org_id', true) as setting`;
    expect(after.pid).toBe(seen.pid);
    expect(after.setting ?? "").toBe("");
    expect(await visible()).toEqual(all([]));
  });

  it("org B scope sees exactly B's row; the NULL-org row is visible only in a platform scope", async () => {
    expect(await runWithTwOrg(orgB, visible)).toEqual(all(["B"]));
    expect(await runWithTwPlatform("rls 2d spec", visible)).toEqual(all(["A", "B", "N"]));
    expect(await visible()).toEqual(all([]));
  });

  it("rejects a cross-org insert for org B under A in each table", async () => {
    const u = ids.users.A;
    const attempts: Record<Table, () => Promise<unknown>> = {
      users: () => prisma.user.create({ data: { email: `x-${tag}@rls.invalid`, twOrgId: orgB }, select: { id: true } }),
      EventType: () =>
        prisma.eventType.create({
          data: { title: "x", slug: `x-${tag}`, length: 30, userId: u, twOrgId: orgB },
          select: { id: true },
        }),
      Booking: () =>
        prisma.booking.create({
          data: { uid: `x-${tag}`, title: "x", startTime: new Date(), endTime: new Date(), userId: u, twOrgId: orgB },
          select: { id: true },
        }),
      Schedule: () =>
        prisma.schedule.create({ data: { name: "x", userId: u, twOrgId: orgB }, select: { id: true } }),
      Credential: () =>
        prisma.credential.create({ data: { type: "x_rls", key: {}, userId: u, twOrgId: orgB }, select: { id: true } }),
    };
    for (const t of TABLES) {
      await expect(runWithTwOrg(orgA, attempts[t]), `${t} cross-org insert`).rejects.toThrow(RLS_ERROR);
      await expect(attempts[t](), `${t} unscoped insert`).rejects.toThrow(RLS_ERROR);
    }
    const { rows } = await admin.query(
      `select (select count(*) from users where email = $1) + (select count(*) from "EventType" where slug = $2)
        + (select count(*) from "Booking" where uid = $2) + (select count(*) from "Schedule" where "twOrgId" = $3 and name = 'x' and "userId" = $4)
        + (select count(*) from "Credential" where type = 'x_rls') as n`,
      [`x-${tag}@rls.invalid`, `x-${tag}`, orgB, u]
    );
    expect(Number(rows[0].n)).toBe(0);
  });

  it("rejects moving A's row to org B (WITH CHECK); B's and the NULL-org rows cannot be updated or deleted from A", async () => {
    await expect(
      runWithTwOrg(orgA, () => prisma.schedule.update({ where: { id: ids.Schedule.A }, data: { twOrgId: orgB } }))
    ).rejects.toThrow(RLS_ERROR);
    await expect(
      runWithTwOrg(orgA, () => prisma.booking.update({ where: { id: ids.Booking.A }, data: { twOrgId: orgB } }))
    ).rejects.toThrow(RLS_ERROR);
    const touched = await runWithTwOrg(orgA, async () => ({
      upd: (
        await prisma.eventType.updateMany({
          where: { id: { in: [ids.EventType.B, ids.EventType.N] } },
          data: { title: "pwned" },
        })
      ).count,
      del: (await prisma.credential.deleteMany({ where: { id: { in: [ids.Credential.B, ids.Credential.N] } } }))
        .count,
    }));
    expect(touched).toEqual({ upd: 0, del: 0 });
    const { rows } = await admin.query(
      `select (select count(*) from "EventType" where title = 'pwned' and id = any($1))::int as pwned,
              (select count(*) from "Credential" where id = any($2))::int as creds,
              (select "twOrgId"::text from "Schedule" where id = $3) as sched_org`,
      [Object.values(ids.EventType), Object.values(ids.Credential), ids.Schedule.A]
    );
    expect(rows[0]).toEqual({ pwned: 0, creds: 3, sched_org: orgA });
  });

  it("an insert in A's scope that does not name twOrgId lands in org A (column default)", async () => {
    const s = await runWithTwOrg(orgA, () =>
      prisma.schedule.create({ data: { name: "default-org", userId: ids.users.A }, select: { id: true, twOrgId: true } })
    );
    created.push({ table: "Schedule", id: s.id });
    expect(s.twOrgId).toBe(orgA);
    expect(await runWithTwOrg(orgB, () => prisma.schedule.count({ where: { id: s.id } }))).toBe(0);
  });

  it("pre-tenant definer lookups still read the RLS tables (owner SELECT policy), NULL org included", async () => {
    expect(await prisma.$queryRaw`select * from tw_resolve_org_for_user_slug(${`core-b-${tag}`})`).toEqual([
      { id: ids.users.B, twOrgId: orgB },
    ]);
    expect(await prisma.$queryRaw`select * from tw_resolve_org_for_user_slug(${`core-n-${tag}`})`).toEqual([
      { id: ids.users.N, twOrgId: null },
    ]);
    expect(
      await prisma.$queryRaw`select * from tw_resolve_org_for_event_type_id(${ids.EventType.A}::int)`
    ).toEqual([{ id: ids.EventType.A, twOrgId: orgA }]);
    expect(await prisma.$queryRaw`select * from tw_resolve_org_for_booking_uid(${`core-uid-b-${tag}`})`).toEqual([
      { id: ids.Booking.B, twOrgId: orgB },
    ]);
    expect(
      await prisma.$queryRaw`select * from tw_resolve_org_for_credential(${ids.Credential.A}::int)`
    ).toEqual([{ id: ids.Credential.A, twOrgId: orgA }]);
  });
});
