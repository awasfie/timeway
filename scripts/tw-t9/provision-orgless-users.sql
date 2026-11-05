-- TW-T9 (t_9824b7a7, Q-18): one-off, idempotent org provisioning for existing users that
-- still have no org after backfill-tw-org-id.sql (residual group B: users 9,10 on 11-05,
-- external webapp signups with no team). Each user goes through public.tw_ensure_user_org
-- (migration 20261105120400), the same function signup and first login call:
-- single team-co-member org if any, else a personal org 'personal-<id>' with the user as
-- owner; then the user's NULL-org Schedule, Credential, EventType and Booking rows follow.
--
-- Run through scripts/tw-t9/provision-orgless-users.sh (--dry-run | --apply), or:
--   psql "$URL" -X -v ON_ERROR_STOP=1 -v mode=dry-run -f provision-orgless-users.sql
-- Run AFTER backfill-tw-org-id.sql (so users that can take an existing org already did).
-- mode=dry-run: BEGIN; provision; report; ROLLBACK.   mode=apply: same, COMMIT.
-- Target set: users."twOrgId" IS NULL and no tw_organization_member row and no accepted
-- team membership (a team user is left to the backfill's team rules; a >1-org conflict is
-- never resolved here). Re-running --apply provisions 0 users. No DELETE, no DDL.
-- Output: ids, org ids and counts only (no PII).

\set QUIET on
\pset footer off
\if :{?mode}
\else
  \set mode dry-run
\endif
SELECT (:'mode' = 'apply') AS is_apply, (:'mode' IN ('apply', 'dry-run')) AS mode_ok \gset
\if :mode_ok
\else
  \echo 'mode must be dry-run or apply'
  \quit 3
\endif
SET lock_timeout = '5s';
SET statement_timeout = '120s';
SET application_name = 'tw-t9-provision-orgless-users';

BEGIN;
SET LOCAL app.tw_platform = 'on';

CREATE TEMP TABLE tw_prov_target ON COMMIT DROP AS
SELECT u.id AS "userId"
FROM public.users u
WHERE u."twOrgId" IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.tw_organization_member m WHERE m."userId" = u.id)
  AND NOT EXISTS (SELECT 1 FROM public."Membership" me WHERE me."userId" = u.id AND me.accepted);

CREATE TEMP TABLE tw_prov_before ON COMMIT DROP AS
SELECT 'Schedule' AS tbl, count(*) AS n FROM public."Schedule" WHERE "twOrgId" IS NULL
UNION ALL SELECT 'Credential', count(*) FROM public."Credential" WHERE "twOrgId" IS NULL
UNION ALL SELECT 'EventType', count(*) FROM public."EventType" WHERE "twOrgId" IS NULL
UNION ALL SELECT 'Booking', count(*) FROM public."Booking" WHERE "twOrgId" IS NULL
UNION ALL SELECT 'users', count(*) FROM public.users WHERE "twOrgId" IS NULL;

\echo '== mode' :mode
\echo '== targets (org-less, teamless users)'
SELECT "userId" FROM tw_prov_target ORDER BY 1;

CREATE TEMP TABLE tw_prov_result ON COMMIT DROP AS
SELECT t."userId", public.tw_ensure_user_org(t."userId") AS "orgId"
FROM tw_prov_target t ORDER BY t."userId";

\echo '== provisioned (userId -> orgId, role)'
SELECT r."userId", r."orgId", m.role, o.slug
FROM tw_prov_result r
LEFT JOIN public.tw_organization_member m ON m."userId" = r."userId" AND m."orgId" = r."orgId"
LEFT JOIN public.tw_organization o ON o.id = r."orgId"
ORDER BY 1;

\echo '== NULL twOrgId before -> after'
SELECT b.tbl, b.n AS before,
  CASE b.tbl
    WHEN 'Schedule' THEN (SELECT count(*) FROM public."Schedule" WHERE "twOrgId" IS NULL)
    WHEN 'Credential' THEN (SELECT count(*) FROM public."Credential" WHERE "twOrgId" IS NULL)
    WHEN 'EventType' THEN (SELECT count(*) FROM public."EventType" WHERE "twOrgId" IS NULL)
    WHEN 'Booking' THEN (SELECT count(*) FROM public."Booking" WHERE "twOrgId" IS NULL)
    WHEN 'users' THEN (SELECT count(*) FROM public.users WHERE "twOrgId" IS NULL)
  END AS after
FROM tw_prov_before b;

\echo '== unresolved targets (must be 0)'
SELECT count(*) AS unresolved FROM tw_prov_result WHERE "orgId" IS NULL;

\if :is_apply
COMMIT;
\echo '== committed'
\else
ROLLBACK;
\echo '== rolled back (dry run)'
\endif
