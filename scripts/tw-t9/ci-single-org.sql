-- TW-T9.2d CI fixture: the E2E/integration database is one Timeway org.
--
-- After 20261016120000_tw_t9_2d the public booking paths resolve the org from the row
-- (no platform fallback), so a row with a NULL twOrgId is not found. Production rows are
-- backfilled (TW-T9.2c); CI rows come from `yarn db-seed` and Playwright fixtures, which
-- never set twOrgId. A database-level app.tw_org_id makes the column default fill it for
-- every session that does not open its own scope, seed and test time alike.
-- CI only: never run against a real database. Idempotent.
--
-- Phase 1 (before migrate/seed, and before a cache restore): psql -v phase=guc
-- Phase 2 (after seed, before the dump):                      psql -v phase=org

\if :{?phase}
\else
  \echo 'set -v phase=guc or -v phase=org'
  \quit
\endif

SELECT :'phase' = 'guc' AS is_guc \gset

\if :is_guc
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET app.tw_org_id = %L', current_database(),
                 '00000000-0000-4000-8000-0000000000c1');
END
$$;
\else
INSERT INTO public.tw_organization (id, slug, name, "updatedAt")
VALUES ('00000000-0000-4000-8000-0000000000c1', 'ci-org', 'CI org', now())
ON CONFLICT (id) DO NOTHING;

UPDATE public.users      SET "twOrgId" = '00000000-0000-4000-8000-0000000000c1' WHERE "twOrgId" IS NULL;
UPDATE public."EventType" SET "twOrgId" = '00000000-0000-4000-8000-0000000000c1' WHERE "twOrgId" IS NULL;
UPDATE public."Booking"   SET "twOrgId" = '00000000-0000-4000-8000-0000000000c1' WHERE "twOrgId" IS NULL;
UPDATE public."Schedule"  SET "twOrgId" = '00000000-0000-4000-8000-0000000000c1' WHERE "twOrgId" IS NULL;
UPDATE public."Credential" SET "twOrgId" = '00000000-0000-4000-8000-0000000000c1' WHERE "twOrgId" IS NULL;
\endif
