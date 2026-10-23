-- TW-T9.2c verification (read-only). Run as timeway_owner.
-- 1) NULL counts per table. 2) consistency: every derived twOrgId agrees with its
-- source (child rows vs owning user / event type / team org); expect 0 mismatches.
-- 3) every non-NULL twOrgId references an existing tw_organization.
\set QUIET on
\pset footer off
BEGIN READ ONLY;
SELECT set_config('app.tw_platform', 'on', true) \g /dev/null

\echo '== twOrgId coverage'
SELECT 'users' AS tbl, count(*) AS total, count("twOrgId") AS with_org, count(*) - count("twOrgId") AS null_rows FROM "users"
UNION ALL SELECT 'EventType',  count(*), count("twOrgId"), count(*) - count("twOrgId") FROM "EventType"
UNION ALL SELECT 'Schedule',   count(*), count("twOrgId"), count(*) - count("twOrgId") FROM "Schedule"
UNION ALL SELECT 'Credential', count(*), count("twOrgId"), count(*) - count("twOrgId") FROM "Credential"
UNION ALL SELECT 'Booking',    count(*), count("twOrgId"), count(*) - count("twOrgId") FROM "Booking"
ORDER BY 1;

\echo '== mismatches (expect all 0)'
SELECT 'users_vs_member' AS check, count(*) AS mismatches
  FROM "users" u
 WHERE u."twOrgId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "tw_organization_member" m WHERE m."userId" = u.id AND m."orgId" = u."twOrgId")
UNION ALL
SELECT 'schedule_vs_user', count(*) FROM "Schedule" s JOIN "users" u ON u.id = s."userId"
 WHERE s."twOrgId" IS DISTINCT FROM u."twOrgId" AND s."twOrgId" IS NOT NULL
UNION ALL
SELECT 'credential_vs_user', count(*) FROM "Credential" c JOIN "users" u ON u.id = c."userId"
 WHERE c."twOrgId" IS DISTINCT FROM u."twOrgId" AND c."twOrgId" IS NOT NULL
UNION ALL
SELECT 'eventtype_vs_user', count(*) FROM "EventType" e JOIN "users" u ON u.id = e."userId"
 WHERE e."twOrgId" IS DISTINCT FROM u."twOrgId" AND e."twOrgId" IS NOT NULL
UNION ALL
SELECT 'team_eventtype_vs_member_orgs', count(*) FROM "EventType" e
 WHERE e."userId" IS NULL AND e."teamId" IS NOT NULL AND e."twOrgId" IS NOT NULL
   AND EXISTS (SELECT 1 FROM "Membership" m JOIN "users" u ON u.id = m."userId"
                WHERE m."teamId" = e."teamId" AND m.accepted
                  AND u."twOrgId" IS NOT NULL AND u."twOrgId" <> e."twOrgId")
UNION ALL
SELECT 'booking_vs_eventtype_or_user', count(*) FROM "Booking" b
  LEFT JOIN "EventType" e ON e.id = b."eventTypeId"
  LEFT JOIN "users" u ON u.id = b."userId"
 WHERE b."twOrgId" IS NOT NULL AND coalesce(e."twOrgId", u."twOrgId") IS NOT NULL
   AND b."twOrgId" <> coalesce(e."twOrgId", u."twOrgId")
UNION ALL
SELECT 'orphan_org_ref', count(*) FROM (
  SELECT "twOrgId" FROM "users" UNION ALL SELECT "twOrgId" FROM "EventType"
  UNION ALL SELECT "twOrgId" FROM "Schedule" UNION ALL SELECT "twOrgId" FROM "Credential"
  UNION ALL SELECT "twOrgId" FROM "Booking") x
 WHERE x."twOrgId" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "tw_organization" o WHERE o.id = x."twOrgId");
ROLLBACK;
