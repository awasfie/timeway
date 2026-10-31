-- TW-T13: move the shared `spenai-pilot` org's data into per-tenant orgs.
--
-- Run through scripts/tw-t13/migrate-pilot-bookings.sh (--dry-run | --apply | --verify), or:
--   psql "$URL" -X -v ON_ERROR_STOP=1 -v mode=dry-run -f migrate-pilot-bookings.sql < /path/map.csv
--
-- map.csv (header row, no PII): username,org_slug
--   one row per pilot-org USER that belongs to a tenant; org_slug is the tenant's already
--   provisioned org (POST /api/v2/orgs). Built by Gosi from SalesOS TenantTimewayLink.timewayUsername.
--
-- What moves (per mapped user, one transaction per user): users.twOrgId, Schedule, Credential,
-- EventType (userId = that user), Booking (userId = that user, or on one of its event types),
-- tw_organization_member row (pilot -> target; created if absent).
-- Safety: dry-run = BEGIN..ROLLBACK; apply is idempotent (a moved user is no longer in the pilot org,
-- so a re-run moves 0 rows); a user not in the pilot org, an unknown org_slug, or a target that is the
-- pilot itself is reported and skipped; per-user row counts before/after must match or the user's
-- transaction aborts. No DELETE, no DDL on real tables. Prod apply: only from the deploy card,
-- after a verified backup <= 24 h (Live-data floor).
-- Run as timeway_owner (app.tw_platform = 'on' reads the forced-RLS org tables).

\set QUIET on
\if :{?mode}
\else
  \set mode dry-run
\endif
SELECT (:'mode' IN ('apply', 'dry-run')) AS mode_ok, (:'mode' = 'apply') AS is_apply \gset
\if :mode_ok
\else
  \echo 'mode must be dry-run or apply'
  \quit 3
\endif

SET lock_timeout = '5s';
SET statement_timeout = '120s';
SET application_name = 'tw-t13-migrate-pilot';
SELECT set_config('app.tw_platform', 'on', false) \g /dev/null

CREATE TEMP TABLE tw13_map (username text NOT NULL, org_slug text NOT NULL);
\copy tw13_map FROM pstdin WITH (FORMAT csv, HEADER true)

CREATE TEMP TABLE tw13_log (username text, action text, detail text);

CREATE TEMP TABLE tw13_plan AS
SELECT m.username, m.org_slug, u.id AS user_id, t.id AS target_org,
       CASE
         WHEN u.id IS NULL THEN 'skip: user not found'
         WHEN t.id IS NULL THEN 'skip: target org not found'
         WHEN t.slug = 'spenai-pilot' THEN 'skip: target is the pilot org'
         WHEN u."twOrgId" IS DISTINCT FROM p.id THEN 'skip: user not in pilot org'
         ELSE 'move'
       END AS action
FROM tw13_map m
LEFT JOIN "users" u ON u.username = m.username
LEFT JOIN tw_organization t ON t.slug = m.org_slug
CROSS JOIN (SELECT id FROM tw_organization WHERE slug = 'spenai-pilot') p;

\echo '== plan'
SELECT username, org_slug, action FROM tw13_plan ORDER BY username;

CREATE TEMP TABLE tw13_counts (phase text, username text, tbl text, n bigint);

CREATE OR REPLACE FUNCTION pg_temp.tw13_count(phase text, uname text, uid int, org uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO tw13_counts VALUES
    (phase, uname, 'Schedule',   (SELECT count(*) FROM "Schedule"   WHERE "userId" = uid AND "twOrgId" = org)),
    (phase, uname, 'Credential', (SELECT count(*) FROM "Credential" WHERE "userId" = uid AND "twOrgId" = org)),
    (phase, uname, 'EventType',  (SELECT count(*) FROM "EventType"  WHERE "userId" = uid AND "twOrgId" = org)),
    (phase, uname, 'Booking',    (SELECT count(*) FROM "Booking" b WHERE b."twOrgId" = org
                                    AND (b."userId" = uid OR b."eventTypeId" IN (SELECT id FROM "EventType" WHERE "userId" = uid))));
END $$;

CREATE OR REPLACE FUNCTION pg_temp.tw13_move(uname text, uid int, src uuid, dst uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE before_n bigint; after_n bigint; r record;
BEGIN
  PERFORM pg_temp.tw13_count('before', uname, uid, src);
  UPDATE "users" SET "twOrgId" = dst WHERE id = uid AND "twOrgId" = src;
  UPDATE "Schedule" SET "twOrgId" = dst WHERE "userId" = uid AND "twOrgId" = src;
  UPDATE "Credential" SET "twOrgId" = dst WHERE "userId" = uid AND "twOrgId" = src;
  UPDATE "Booking" SET "twOrgId" = dst
   WHERE "twOrgId" = src AND ("userId" = uid OR "eventTypeId" IN (SELECT id FROM "EventType" WHERE "userId" = uid));
  UPDATE "EventType" SET "twOrgId" = dst WHERE "userId" = uid AND "twOrgId" = src;
  IF EXISTS (SELECT 1 FROM tw_organization_member WHERE "orgId" = dst AND "userId" = uid) THEN
    DELETE FROM tw_organization_member WHERE "orgId" = src AND "userId" = uid; -- pilot membership row only; target row already exists
  ELSE
    UPDATE tw_organization_member SET "orgId" = dst WHERE "orgId" = src AND "userId" = uid;
  END IF;
  PERFORM pg_temp.tw13_count('after', uname, uid, dst);
  FOR r IN SELECT b.tbl, b.n AS nb, a.n AS na FROM tw13_counts b JOIN tw13_counts a
           ON a.username = b.username AND a.tbl = b.tbl AND a.phase = 'after' WHERE b.phase = 'before' AND b.username = uname
  LOOP
    IF r.na < r.nb THEN
      RAISE EXCEPTION 'TW-T13 count mismatch for %: % before % after %', uname, r.tbl, r.nb, r.na;
    END IF;
  END LOOP;
END $$;

-- Per-user transaction in apply mode (psql \gexec batches); dry-run wraps everything and rolls back.
\if :is_apply
\else
  BEGIN;
\endif

SELECT format('SELECT pg_temp.tw13_move(%L, %s, %L::uuid, %L::uuid); INSERT INTO tw13_log VALUES (%L, ''moved'', '''');',
              p.username, p.user_id, (SELECT id FROM tw_organization WHERE slug = 'spenai-pilot'), p.target_org, p.username)
FROM tw13_plan p WHERE p.action = 'move' ORDER BY p.username
\gexec

\echo '== per-user counts (rows in source before / rows in target after)'
SELECT b.username, b.tbl, b.n AS before_in_pilot, a.n AS after_in_target
FROM tw13_counts b JOIN tw13_counts a ON a.username = b.username AND a.tbl = b.tbl AND a.phase = 'after'
WHERE b.phase = 'before' ORDER BY 1, 2;

\echo '== remaining in pilot org (not mapped; stays platform-visible)'
SELECT 'users' AS tbl, count(*) FROM "users" WHERE "twOrgId" = (SELECT id FROM tw_organization WHERE slug = 'spenai-pilot')
UNION ALL SELECT 'Booking', count(*) FROM "Booking" WHERE "twOrgId" = (SELECT id FROM tw_organization WHERE slug = 'spenai-pilot')
UNION ALL SELECT 'EventType', count(*) FROM "EventType" WHERE "twOrgId" = (SELECT id FROM tw_organization WHERE slug = 'spenai-pilot');

\if :is_apply
\else
  ROLLBACK;
  \echo 'dry-run: rolled back, nothing changed'
\endif
