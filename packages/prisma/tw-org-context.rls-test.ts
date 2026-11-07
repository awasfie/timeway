/**
 * TW-T9.2a (WC-PE-6 timeway, proof CC-89 line): org context on the REAL pool.
 *
 * Runs the production `prisma` client from packages/prisma/index.ts as the runtime
 * role timeway_app (NOSUPERUSER NOBYPASSRLS, owns nothing) on a pool of ONE, so
 * every query provably reuses the same backend:
 *   1. a request scoped to org A (runWithTwOrg) sees only A's tw_ rows, top-level,
 *      in a batch and in an interactive transaction;
 *   2. after it ends, the next unscoped query on that backend sees '' and 0 rows;
 *   3. a write for org B under A's scope, and a write with no scope, are rejected;
 *   4. the pre-tenant SECURITY DEFINER lookups work for timeway_app and return
 *      ids/org only.
 *
 * Env (set by the CI `rls` job): DATABASE_URL = timeway_app, DATABASE_POOL_MAX=1,
 * RLS_ADMIN_DATABASE_URL = a role that may seed across orgs. Missing env FAILS the
 * suite; it is never skipped. Not part of the unit run (vitest.rls.config.mts).
 */
import { randomUUID } from "node:crypto";
import process from "node:process";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "./index";
import { getTwOrgContext, runWithTwOrg, runWithTwPlatform } from "./tw-org-context";

const ADMIN_URL = process.env.RLS_ADMIN_DATABASE_URL;
const RLS_ERROR = /row-level security|42501/i;

describe("TW-T9.2a org context on the real pool (timeway_app)", () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  const orgA = randomUUID();
  const orgB = randomUUID();
  const tag = randomUUID().slice(0, 8);
  const ids = { userA: 0, userB: 0, team: 0, booking: 0, credential: 0, eventType: 0, attendee: 0, seat: 0 };

  beforeAll(async () => {
    expect(ADMIN_URL, "RLS_ADMIN_DATABASE_URL must be set; this suite is never skipped").toBeTruthy();
    expect(process.env.DATABASE_POOL_MAX).toBe("1");
    await admin.connect();
    await admin.query("begin");
    await admin.query("select set_config('app.tw_platform', 'on', true)");
    await admin.query(
      `insert into tw_organization (id, slug, name, "updatedAt") values ($1, $2, 'A', now()), ($3, $4, 'B', now())`,
      [orgA, `a-${tag}`, orgB, `b-${tag}`]
    );
    const { rows: users } = await admin.query(
      `insert into users (email, username, uuid, "twOrgId") values ($1, $2, gen_random_uuid(), $3), ($4, $5, gen_random_uuid(), $6) returning id`,
      [`a-${tag}@rls.invalid`, `a-${tag}`, orgA, `b-${tag}@rls.invalid`, `b-${tag}`, orgB]
    );
    [ids.userA, ids.userB] = users.map((r) => r.id);
    await admin.query(
      `insert into tw_organization_member (id, "orgId", "userId", role) values (gen_random_uuid(), $1, $2, 'owner'), (gen_random_uuid(), $3, $4, 'owner')`,
      [orgA, ids.userA, orgB, ids.userB]
    );
    await admin.query(
      `insert into tw_org_api_key (id, "orgId", prefix, "hashedKey", scopes) values (gen_random_uuid(), $1, $2, 'h', '{}'), (gen_random_uuid(), $3, $4, 'h', '{}')`,
      [orgA, `a${tag}_`, orgB, `b${tag}_`]
    );
    const { rows: team } = await admin.query(
      `insert into "Team" (name, slug) values ('A', $1) returning id`,
      [`t-${tag}`]
    );
    ids.team = team[0].id;
    await admin.query(
      `insert into "Membership" ("teamId", "userId", accepted, role) values ($1, $2, true, 'OWNER')`,
      [ids.team, ids.userA]
    );
    const { rows: booking } = await admin.query(
      `insert into "Booking" (uid, title, "startTime", "endTime", "userId", "twOrgId") values ($1, 'x', now(), now(), $2, $3) returning id`,
      [`uid-${tag}`, ids.userA, orgA]
    );
    ids.booking = booking[0].id;
    const { rows: cred } = await admin.query(
      `insert into "Credential" (type, key, "userId", "twOrgId") values ('rls_test', '{"secret":"x"}', $1, $2) returning id`,
      [ids.userA, orgA]
    );
    ids.credential = cred[0].id;
    const { rows: et } = await admin.query(
      `insert into "EventType" (title, slug, length, "userId", "twOrgId") values ('x', $1, 30, $2, $3) returning id`,
      [`et-${tag}`, ids.userA, orgA]
    );
    ids.eventType = et[0].id;
    const { rows: att } = await admin.query(
      `insert into "Attendee" (email, name, "timeZone", "bookingId") values ($1, 'x', 'UTC', $2) returning id`,
      [`seat-${tag}@rls.invalid`, ids.booking]
    );
    ids.attendee = att[0].id;
    const { rows: seat } = await admin.query(
      `insert into "BookingSeat" ("referenceUid", "bookingId", "attendeeId") values ($1, $2, $3) returning id`,
      [`seat-${tag}`, ids.booking, ids.attendee]
    );
    ids.seat = seat[0].id;
    await admin.query("commit");
  });

  afterAll(async () => {
    await admin.query("begin");
    await admin.query("select set_config('app.tw_platform', 'on', true)");
    await admin.query(`delete from "Credential" where id = $1`, [ids.credential]);
    await admin.query(`delete from "EventType" where id = $1`, [ids.eventType]);
    await admin.query(`delete from "Booking" where id = $1`, [ids.booking]);
    await admin.query(`delete from "Team" where id = $1`, [ids.team]);
    await admin.query(`delete from tw_organization where id in ($1, $2)`, [orgA, orgB]);
    await admin.query(`delete from users where id in ($1, $2)`, [ids.userA, ids.userB]);
    await admin.query("commit");
    await admin.end();
    await prisma.$disconnect();
  });

  it("runs as timeway_app: not superuser, no BYPASSRLS", async () => {
    const [role] = await prisma.$queryRaw<{ u: string; sup: boolean; bypass: boolean }[]>`
      select current_user::text as u, rolsuper as sup, rolbypassrls as bypass from pg_roles where rolname = current_user`;
    expect(role).toEqual({ u: "timeway_app", sup: false, bypass: false });
  });

  it("org A scope sees only A; released, the same backend sees '' and 0 rows", async () => {
    const seen = await runWithTwOrg(orgA, async () => {
      const [probe] = await prisma.$queryRaw<{ pid: number; setting: string }[]>`
        select pg_backend_pid() as pid, current_setting('app.tw_org_id', true) as setting`;
      const orgs = await prisma.organization.findMany({
        where: { id: { in: [orgA, orgB] } },
        select: { id: true },
      });
      const [members, keys] = await prisma.$transaction([
        prisma.organizationMember.count({ where: { orgId: { in: [orgA, orgB] } } }),
        prisma.orgApiKey.count({ where: { orgId: { in: [orgA, orgB] } } }),
      ]);
      const interactive = await prisma.$transaction(async (tx) => ({
        setting: (await tx.$queryRaw<{ s: string }[]>`select current_setting('app.tw_org_id', true) as s`)[0]
          .s,
        orgs: await tx.organization.count({ where: { id: { in: [orgA, orgB] } } }),
      }));
      return { probe, orgs, members, keys, interactive };
    });
    expect(seen.probe.setting).toBe(orgA);
    expect(seen.orgs).toEqual([{ id: orgA }]);
    expect(seen).toMatchObject({ members: 1, keys: 1, interactive: { setting: orgA, orgs: 1 } });
    expect(getTwOrgContext()).toBeUndefined();

    const [after] = await prisma.$queryRaw<{ pid: number; setting: string | null }[]>`
      select pg_backend_pid() as pid, current_setting('app.tw_org_id', true) as setting`;
    expect(after.pid).toBe(seen.probe.pid);
    expect(after.setting ?? "").toBe("");
    expect(await prisma.organization.count({ where: { id: { in: [orgA, orgB] } } })).toBe(0);
    expect(await prisma.organizationMember.count({ where: { orgId: { in: [orgA, orgB] } } })).toBe(0);
    expect(await prisma.orgApiKey.count({ where: { orgId: { in: [orgA, orgB] } } })).toBe(0);
  });

  it("platform scope sees both orgs and leaves nothing behind", async () => {
    const n = await runWithTwPlatform("rls spec", () =>
      prisma.organization.count({ where: { id: { in: [orgA, orgB] } } })
    );
    expect(n).toBe(2);
    expect(await prisma.organization.count({ where: { id: { in: [orgA, orgB] } } })).toBe(0);
  });

  it("rejects a cross-org write and a write with no scope", async () => {
    await expect(
      runWithTwOrg(orgA, () =>
        prisma.orgApiKey.create({ data: { orgId: orgB, prefix: `x${tag}_`, hashedKey: "h" } })
      )
    ).rejects.toThrow(RLS_ERROR);
    await expect(
      runWithTwOrg(orgA, () =>
        prisma.$transaction(async (tx) =>
          tx.organizationMember.create({ data: { orgId: orgB, userId: ids.userA, role: "admin" } })
        )
      )
    ).rejects.toThrow(RLS_ERROR);
    await expect(
      prisma.orgApiKey.create({ data: { orgId: orgA, prefix: `y${tag}_`, hashedKey: "h" } })
    ).rejects.toThrow(RLS_ERROR);
    const { rows } = await admin.query(
      `select count(*)::int n from tw_org_api_key where prefix in ($1, $2)`,
      [`x${tag}_`, `y${tag}_`]
    );
    expect(rows[0].n).toBe(0);
  });

  it("pre-tenant lookups: definer functions callable by timeway_app, ids and org only", async () => {
    const login = await prisma.$queryRaw<Record<string, unknown>[]>`
      select * from tw_resolve_user_for_login(${`A-${tag}@RLS.invalid`})`;
    expect(login).toEqual([{ id: ids.userA, twOrgId: orgA }]);
    expect(await prisma.$queryRaw`select * from tw_resolve_org_for_user_slug(${`b-${tag}`})`).toEqual([
      { id: ids.userB, twOrgId: orgB },
    ]);
    expect(await prisma.$queryRaw`select * from tw_resolve_org_for_team_slug(${`t-${tag}`})`).toEqual([
      { id: ids.team, twOrgId: orgA },
    ]);
    expect(await prisma.$queryRaw`select * from tw_resolve_org_for_booking_uid(${`uid-${tag}`})`).toEqual([
      { id: ids.booking, twOrgId: orgA },
    ]);
    expect(
      await prisma.$queryRaw`select * from tw_resolve_org_for_credential(${ids.credential}::int)`
    ).toEqual([{ id: ids.credential, twOrgId: orgA }]);
    expect(await prisma.$queryRaw`select * from tw_resolve_user_for_login(${"nobody@rls.invalid"})`).toEqual(
      []
    );
  });

  it("TW-T9.2b2f lookups: event type id and seat reference resolve for timeway_app, ids and org only", async () => {
    expect(
      await prisma.$queryRaw`select * from tw_resolve_org_for_event_type_id(${ids.eventType}::int)`
    ).toEqual([{ id: ids.eventType, twOrgId: orgA }]);
    expect(await prisma.$queryRaw`select * from tw_resolve_org_for_seat_reference(${`seat-${tag}`})`).toEqual(
      [{ id: ids.seat, twOrgId: orgA }]
    );
    expect(await prisma.$queryRaw`select * from tw_resolve_org_for_event_type_id(${-1}::int)`).toEqual([]);
    expect(
      await prisma.$queryRaw`select * from tw_resolve_org_for_seat_reference(${"no-such-seat"})`
    ).toEqual([]);
  });

  it("definer functions: owned by timeway_owner, pinned search_path, EXECUTE for timeway_app only", async () => {
    const { rows } = await admin.query(`
      select p.proname, pg_get_userbyid(p.proowner) as owner, p.prosecdef, p.proconfig,
             has_function_privilege('public', p.oid, 'EXECUTE') as public_exec,
             has_function_privilege('timeway_app', p.oid, 'EXECUTE') as app_exec
      from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'tw_resolve_%'
      order by p.proname`);
    expect(rows.map((r) => r.proname)).toEqual([
      "tw_resolve_org_for_booking_uid",
      "tw_resolve_org_for_credential",
      "tw_resolve_org_for_event_type_id",
      "tw_resolve_org_for_seat_reference",
      "tw_resolve_org_for_team_slug",
      "tw_resolve_org_for_user_slug",
      "tw_resolve_user_for_login",
    ]);
    for (const r of rows) {
      expect(r).toMatchObject({
        owner: "timeway_owner",
        prosecdef: true,
        public_exec: false,
        app_exec: true,
      });
      expect(r.proconfig).toContain("search_path=pg_catalog, public");
    }
  });
});
