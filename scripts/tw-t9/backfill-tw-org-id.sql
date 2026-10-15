-- TW-T9.2c (WC-PE-6 timeway, Bible Q-3 / WC-30 step 5): backfill "twOrgId" on
-- users, EventType (user and team types), Schedule, Credential, Booking so
-- that the RLS migration (TW-T9.2d) does not hide live rows.
--
-- Run through scripts/tw-t9/backfill-tw-org-id.sh (--dry-run | --apply), or:
--   psql "$URL" -X -v ON_ERROR_STOP=1 -v mode=dry-run -v batch=500 -f backfill-tw-org-id.sql
--
-- mode=dry-run  one transaction: BEGIN; backfill; report; ROLLBACK.
-- mode=apply    one transaction per batch (COMMIT after each batch), then report.
-- Run as timeway_owner (table owner). tw_organization_member has FORCE RLS,
-- so the session sets app.tw_platform = 'on' to read memberships.
--
-- Idempotent: every UPDATE is restricted to rows WHERE "twOrgId" IS NULL;
-- a second run changes 0 rows. No DELETE, no DDL on real tables, no NOT NULL / FK
-- (that is the contract slice).
--
-- Derivation (decided on t_bb79259a, do not re-open):
--   users      <- its tw_organization_member org (exactly one; >1 = report, skip)
--   Schedule   <- owning user's twOrgId
--   Credential <- owning user's twOrgId (team credentials without userId stay NULL)
--   EventType  <- userId: user's twOrgId
--              <- teamId (no userId): the single org held by the team's accepted
--                 members (0 or >1 distinct orgs = report, skip). Members with no
--                 org yet do not count as a second org; they are reported.
--   Booking    <- its EventType's twOrgId, else its user's twOrgId
-- Rows that stay NULL are platform-only after RLS; the residual list (ids and
-- reason only, no PII) is printed at the end.

\set QUIET on
\pset footer off
\if :{?mode}
\else
  \set mode dry-run
\endif
\if :{?batch}
\else
  \set batch 500
\endif

SELECT (:'mode' = 'apply') AS is_apply, (:'mode' IN ('apply', 'dry-run')) AS mode_ok \gset
\if :mode_ok
\else
  \echo 'mode must be dry-run or apply'
  \quit 3
\endif

SET lock_timeout = '5s';
SET statement_timeout = '120s';
SET application_name = 'tw-t9-backfill-tw-org-id';
SELECT set_config('app.tw_platform', 'on', false) \g /dev/null

-- Run log, session-local; survives the per-batch COMMITs in apply mode.
CREATE TEMP TABLE tw_backfill_log (
  step   text    NOT NULL,
  batch  integer NOT NULL,
  rows   integer NOT NULL,
  at     timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TEMP TABLE tw_backfill_before AS
SELECT 'users' AS tbl, count(*) AS total, count(*) FILTER (WHERE "twOrgId" IS NULL) AS null_rows FROM "users"
UNION ALL SELECT 'EventType',  count(*), count(*) FILTER (WHERE "twOrgId" IS NULL) FROM "EventType"
UNION ALL SELECT 'Schedule',   count(*), count(*) FILTER (WHERE "twOrgId" IS NULL) FROM "Schedule"
UNION ALL SELECT 'Credential', count(*), count(*) FILTER (WHERE "twOrgId" IS NULL) FROM "Credential"
UNION ALL SELECT 'Booking',    count(*), count(*) FILTER (WHERE "twOrgId" IS NULL) FROM "Booking";

-- Derivation views (temp, read-only). Each yields (id, org) for rows that are
-- NULL now and have exactly one derivable org.
CREATE TEMP VIEW tw_d_users AS
  SELECT u.id, min(m."orgId"::text)::uuid AS org
  FROM "users" u JOIN "tw_organization_member" m ON m."userId" = u.id
  WHERE u."twOrgId" IS NULL
  GROUP BY u.id
  HAVING count(DISTINCT m."orgId") = 1;

CREATE TEMP VIEW tw_d_schedule AS
  SELECT s.id, u."twOrgId" AS org
  FROM "Schedule" s JOIN "users" u ON u.id = s."userId"
  WHERE s."twOrgId" IS NULL AND u."twOrgId" IS NOT NULL;

CREATE TEMP VIEW tw_d_credential AS
  SELECT c.id, u."twOrgId" AS org
  FROM "Credential" c JOIN "users" u ON u.id = c."userId"
  WHERE c."twOrgId" IS NULL AND u."twOrgId" IS NOT NULL;

CREATE TEMP VIEW tw_d_eventtype_user AS
  SELECT e.id, u."twOrgId" AS org
  FROM "EventType" e JOIN "users" u ON u.id = e."userId"
  WHERE e."twOrgId" IS NULL AND u."twOrgId" IS NOT NULL;

-- Team org: all accepted members must carry the same non-NULL org.
CREATE TEMP VIEW tw_team_org AS
  SELECT m."teamId" AS team_id,
         count(*)                                         AS accepted_members,
         count(*) FILTER (WHERE u."twOrgId" IS NULL)      AS members_without_org,
         count(DISTINCT u."twOrgId")                      AS distinct_orgs,
         min(u."twOrgId"::text)::uuid                     AS org
  FROM "Membership" m JOIN "users" u ON u.id = m."userId"
  WHERE m.accepted
  GROUP BY m."teamId";

CREATE TEMP VIEW tw_d_eventtype_team AS
  SELECT e.id, t.org
  FROM "EventType" e JOIN tw_team_org t ON t.team_id = e."teamId"
  WHERE e."twOrgId" IS NULL AND e."userId" IS NULL
    AND t.distinct_orgs = 1;

\echo '== team orgs before backfill (teams with NULL team event types)'
SELECT t.team_id, t.accepted_members, t.members_without_org, t.distinct_orgs,
       CASE WHEN t.distinct_orgs = 1 THEN 'derive' ELSE 'skip' END AS action
FROM tw_team_org t
WHERE EXISTS (SELECT 1 FROM "EventType" e
              WHERE e."teamId" = t.team_id AND e."userId" IS NULL AND e."twOrgId" IS NULL)
ORDER BY 1;

CREATE TEMP VIEW tw_d_booking AS
  SELECT b.id, coalesce(e."twOrgId", u."twOrgId") AS org
  FROM "Booking" b
  LEFT JOIN "EventType" e ON e.id = b."eventTypeId"
  LEFT JOIN "users" u     ON u.id = b."userId"
  WHERE b."twOrgId" IS NULL AND coalesce(e."twOrgId", u."twOrgId") IS NOT NULL;

-- Batched backfill. p_commit = true commits after every batch (apply);
-- false runs inside the caller's transaction (dry-run).
CREATE PROCEDURE pg_temp.tw_backfill(p_batch integer, p_commit boolean)
LANGUAGE plpgsql AS $proc$
DECLARE
  steps text[] := ARRAY[
    'users:tw_d_users',
    'Schedule:tw_d_schedule',
    'Credential:tw_d_credential',
    'EventType:tw_d_eventtype_user',
    'EventType:tw_d_eventtype_team',
    'Booking:tw_d_booking'];
  s text; tbl text; src text; n integer; b integer;
BEGIN
  FOREACH s IN ARRAY steps LOOP
    tbl := split_part(s, ':', 1);
    src := split_part(s, ':', 2);
    b := 0;
    LOOP
      b := b + 1;
      EXECUTE format(
        'UPDATE %I t SET "twOrgId" = d.org
           FROM (SELECT id, org FROM pg_temp.%I ORDER BY id LIMIT %s) d
          WHERE t.id = d.id AND t."twOrgId" IS NULL', tbl, src, p_batch);
      GET DIAGNOSTICS n = ROW_COUNT;
      INSERT INTO tw_backfill_log(step, batch, rows) VALUES (src, b, n);
      IF p_commit THEN COMMIT; END IF;
      EXIT WHEN n < p_batch;
    END LOOP;
  END LOOP;
END
$proc$;

\if :is_apply
  \echo '== mode: apply (COMMIT per batch of' :batch 'rows)'
  CALL pg_temp.tw_backfill(:batch, true);
\else
  \echo '== mode: dry-run (single transaction, ROLLBACK at end)'
  BEGIN;
  CALL pg_temp.tw_backfill(:batch, false);
\endif

\echo '== rows changed per step'
SELECT step, sum(rows) AS rows_changed, count(*) AS batches
FROM tw_backfill_log GROUP BY step
ORDER BY min(at);

\echo '== NULL twOrgId before -> after'
SELECT b.tbl, b.total, b.null_rows AS null_before, a.null_rows AS null_after
FROM tw_backfill_before b
JOIN (
  SELECT 'users' AS tbl, count(*) FILTER (WHERE "twOrgId" IS NULL) AS null_rows FROM "users"
  UNION ALL SELECT 'EventType',  count(*) FILTER (WHERE "twOrgId" IS NULL) FROM "EventType"
  UNION ALL SELECT 'Schedule',   count(*) FILTER (WHERE "twOrgId" IS NULL) FROM "Schedule"
  UNION ALL SELECT 'Credential', count(*) FILTER (WHERE "twOrgId" IS NULL) FROM "Credential"
  UNION ALL SELECT 'Booking',    count(*) FILTER (WHERE "twOrgId" IS NULL) FROM "Booking"
) a USING (tbl)
ORDER BY 1;

\echo '== residual NULL rows (ids only; platform-only after RLS)'
SELECT 'users' AS tbl, u.id,
       CASE WHEN count(m.id) = 0 THEN 'no tw_organization_member row'
            ELSE 'member of ' || count(DISTINCT m."orgId") || ' orgs' END AS reason
FROM "users" u LEFT JOIN "tw_organization_member" m ON m."userId" = u.id
WHERE u."twOrgId" IS NULL GROUP BY u.id
UNION ALL
SELECT 'Schedule', s.id,
       CASE WHEN s."userId" IS NULL THEN 'no userId' ELSE 'user ' || s."userId" || ' has no twOrgId' END
FROM "Schedule" s WHERE s."twOrgId" IS NULL
UNION ALL
SELECT 'Credential', c.id,
       CASE WHEN c."userId" IS NOT NULL THEN 'user ' || c."userId" || ' has no twOrgId'
            WHEN c."teamId" IS NOT NULL THEN 'team ' || c."teamId" || ' credential, no userId'
            ELSE 'no userId/teamId' END
FROM "Credential" c WHERE c."twOrgId" IS NULL
UNION ALL
SELECT 'EventType', e.id,
       CASE WHEN e."userId" IS NOT NULL THEN 'user ' || e."userId" || ' has no twOrgId'
            WHEN e."teamId" IS NULL THEN 'no userId/teamId'
            WHEN t.team_id IS NULL THEN 'team ' || e."teamId" || ': no accepted members'
            ELSE 'team ' || e."teamId" || ': ' || t.distinct_orgs || ' orgs, '
                 || t.members_without_org || '/' || t.accepted_members || ' accepted members without org' END
FROM "EventType" e LEFT JOIN tw_team_org t ON t.team_id = e."teamId"
WHERE e."twOrgId" IS NULL
UNION ALL
SELECT 'Booking', b.id, 'eventType ' || coalesce(b."eventTypeId"::text, '-') || ' and user '
       || coalesce(b."userId"::text, '-') || ' have no twOrgId'
FROM "Booking" b WHERE b."twOrgId" IS NULL
ORDER BY 1, 2;

\if :is_apply
  \echo '== applied'
\else
  ROLLBACK;
  \echo '== dry-run: rolled back, nothing written'
\endif
