#!/usr/bin/env node
/**
 * CC-13 — Org isolation conformance probe, DB layer  (Bible v12.3 PART CC / CC-13, TW-T9)
 *
 * "org-A key/session attempts reads+writes on org-B ... -> all denied; runs in CI."
 *
 * This slice proves the layer every later surface sits on: the FORCED row-level
 * security on the TW-T9 tables. Pages / tRPC / API v2 / webhook-config probes are
 * added to this same file as those surfaces land (TW-T10+); until then this
 * script says so in its output rather than claiming them.
 *
 * Runs ONLY against a throwaway CI Postgres (refuses otherwise). It needs a
 * superuser URL (to create the probe role and seed); every assertion then runs
 * as a NON-superuser, NON-owner role, because superusers and BYPASSRLS roles
 * skip RLS and would make the probe prove nothing.
 *
 * Env: CC13_DATABASE_URL (superuser, CI only). CC13_ALLOW=ci must be set.
 */
import pg from "pg";

const url = process.env.CC13_DATABASE_URL;
if (!url || process.env.CC13_ALLOW !== "ci") {
  console.error("CC-13: refuses to run without CC13_DATABASE_URL and CC13_ALLOW=ci (throwaway DB only)");
  process.exit(2);
}
const host = new URL(url).hostname;
if (!["localhost", "127.0.0.1", "postgres"].includes(host)) {
  console.error(`CC-13: refuses non-local host ${host}`);
  process.exit(2);
}

const ROLE = "cc13_probe";
const PW = "cc13_probe_pw";
const TABLES = ["tw_organization", "tw_organization_member", "tw_org_api_key"];
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const admin = new pg.Client({ connectionString: url });
await admin.connect();

// 0. Structural: RLS enabled AND forced on every TW-T9 table.
for (const t of TABLES) {
  const { rows } = await admin.query(
    "select relrowsecurity, relforcerowsecurity from pg_class where relname = $1 and relnamespace = 'public'::regnamespace",
    [t]
  );
  check(`S0 ${t} RLS enabled+forced`, rows.length === 1 && rows[0].relrowsecurity && rows[0].relforcerowsecurity);
}

// Probe role: plain login, no superuser, no bypassrls, not the table owner.
await admin.query(`drop role if exists ${ROLE}`).catch(() => {});
await admin.query(`create role ${ROLE} login password '${PW}' nosuperuser nobypassrls`);
await admin.query(`grant usage on schema public to ${ROLE}`);
for (const t of TABLES) await admin.query(`grant select, insert, update, delete on "public"."${t}" to ${ROLE}`);
await admin.query(`grant select on "public"."users" to ${ROLE}`);

// Seed as platform via the probe role itself (exercises the platform branch too).
const probeUrl = new URL(url);
probeUrl.username = ROLE;
probeUrl.password = PW;
const app = new pg.Client({ connectionString: probeUrl.toString() });
await app.connect();

const { rows: u } = await admin.query(
  `insert into "public"."users" (email, username, uuid) values ('cc13-a@probe.invalid','cc13a',gen_random_uuid()), ('cc13-b@probe.invalid','cc13b',gen_random_uuid()) returning id`
);
const [userA, userB] = u.map((r) => r.id);

async function tx(settings, fn) {
  await app.query("begin");
  try {
    for (const [k, v] of Object.entries(settings)) await app.query("select set_config($1, $2, true)", [k, v]);
    return await fn();
  } finally {
    await app.query("rollback").catch(() => {});
  }
}

// Seed commits (platform), so use explicit commit.
await app.query("begin");
await app.query("select set_config('app.tw_platform','on',true)");
const { rows: orgs } = await app.query(
  `insert into tw_organization (id, slug, name, "updatedAt") values (gen_random_uuid(),'cc13-a','CC13 A',now()), (gen_random_uuid(),'cc13-b','CC13 B',now()) returning id, slug`
);
const orgA = orgs.find((o) => o.slug === "cc13-a").id;
const orgB = orgs.find((o) => o.slug === "cc13-b").id;
await app.query(`insert into tw_organization_member (id,"orgId","userId",role) values (gen_random_uuid(),$1,$2,'owner'),(gen_random_uuid(),$3,$4,'owner')`, [orgA, userA, orgB, userB]);
await app.query(`insert into tw_org_api_key (id,"orgId",prefix,"hashedKey",scopes) values (gen_random_uuid(),$1,'cc13a_','h',ARRAY['*']),(gen_random_uuid(),$2,'cc13b_','h',ARRAY['*'])`, [orgA, orgB]);
await app.query("commit");

// 1. No context at all -> zero rows everywhere (fail-closed).
await tx({}, async () => {
  for (const t of TABLES) {
    const { rows } = await app.query(`select count(*)::int n from ${t}`);
    check(`S1 no-context sees 0 rows in ${t}`, rows[0].n === 0, `n=${rows[0].n}`);
  }
});

// 2. Org A context: reads see only A, even when B is named explicitly.
await tx({ "app.tw_org_id": orgA }, async () => {
  for (const t of TABLES) {
    const col = t === "tw_organization" ? "id" : '"orgId"';
    const { rows: all } = await app.query(`select ${col}::text o from ${t}`);
    check(`S2 A sees only A in ${t}`, all.length > 0 && all.every((r) => r.o === orgA), `rows=${all.length}`);
    const { rows: forged } = await app.query(`select count(*)::int n from ${t} where ${col} = $1`, [orgB]);
    check(`S2 A reading B by id in ${t} -> 0`, forged[0].n === 0);
  }
});

// 3. Org A context: writes on B are denied or affect nothing.
await tx({ "app.tw_org_id": orgA }, async () => {
  const up = await app.query(`update tw_organization set name='pwned' where id=$1`, [orgB]);
  check("S3 A update B org -> 0 rows", up.rowCount === 0);
  const del = await app.query(`delete from tw_org_api_key where "orgId"=$1`, [orgB]);
  check("S3 A delete B api keys -> 0 rows", del.rowCount === 0);
  const upm = await app.query(`update tw_organization_member set role='member' where "orgId"=$1`, [orgB]);
  check("S3 A demote B owner -> 0 rows", upm.rowCount === 0);
});
for (const [name, sql, params] of [
  ["S3 A insert member into B -> denied", `insert into tw_organization_member (id,"orgId","userId",role) values (gen_random_uuid(),$1,$2,'admin')`, [orgB, userA]],
  ["S3 A mint key for B -> denied", `insert into tw_org_api_key (id,"orgId",prefix,"hashedKey",scopes) values (gen_random_uuid(),$1,'cc13x_','h',ARRAY['*'])`, [orgB]],
  ["S3 A move own member to B -> denied", `update tw_organization_member set "orgId"=$1 where "orgId"=$2`, [orgB, orgA]],
]) {
  let denied = false;
  await tx({ "app.tw_org_id": orgA }, async () => {
    try {
      await app.query(sql, params);
    } catch (e) {
      denied = /row-level security/i.test(String(e.message));
    }
  });
  check(name, denied);
}

// 4. Setting the platform flag requires the literal 'on'.
await tx({ "app.tw_platform": "true" }, async () => {
  const { rows } = await app.query(`select count(*)::int n from tw_organization`);
  check("S4 app.tw_platform='true' is not platform -> 0", rows[0].n === 0);
});

// Cleanup (throwaway DB, but leave it tidy).
await app.end();
await admin.query(`delete from tw_organization where slug in ('cc13-a','cc13-b')`);
await admin.query(`delete from users where email like 'cc13-%@probe.invalid'`);
await admin.query(`drop owned by ${ROLE}`);
await admin.query(`drop role ${ROLE}`);
await admin.end();

console.log("NOTE  surfaces not yet probed (land with TW-T10+): pages, tRPC, API v2, webhook config, provision");
const failed = results.filter((r) => !r.ok).length;
console.log(`CC-13 DB layer: ${results.length - failed}/${results.length} PASS`);
process.exit(failed ? 1 : 0);
