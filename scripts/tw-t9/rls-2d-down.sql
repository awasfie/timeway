-- TW-T9.2d rollback (deploy card auto-rollback). Run as timeway_owner, one transaction:
--   psql "$OWNER_URL" -v ON_ERROR_STOP=1 --single-transaction -f scripts/tw-t9/rls-2d-down.sql
--
-- Reverses migration 20261016120000_tw_t9_2d_rls_core_tables on the five Cal.com tables
-- only: DISABLE + NO FORCE row level security, drop the isolation and owner-read policies,
-- drop the twOrgId column default. No row is read or written. Idempotent.
--
-- Deliberately NOT reversed:
--   * the slice-1 tables (tw_organization, tw_organization_member, tw_org_api_key) keep
--     RLS and their NULLIF policies: same rows visible for a set org id, and RLS on them
--     predates this migration;
--   * the _prisma_migrations row stays: the deploy card re-applies by re-running the
--     migration SQL (it is idempotent), not by `migrate deploy`.

ALTER TABLE "public"."users"      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."users"      DISABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."EventType"  NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."EventType"  DISABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Booking"    NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."Booking"    DISABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Schedule"   NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."Schedule"   DISABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Credential" NO FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."Credential" DISABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_tw_org_isolation"      ON "public"."users";
DROP POLICY IF EXISTS "EventType_tw_org_isolation"  ON "public"."EventType";
DROP POLICY IF EXISTS "Booking_tw_org_isolation"    ON "public"."Booking";
DROP POLICY IF EXISTS "Schedule_tw_org_isolation"   ON "public"."Schedule";
DROP POLICY IF EXISTS "Credential_tw_org_isolation" ON "public"."Credential";

DROP POLICY IF EXISTS "users_tw_owner_read"      ON "public"."users";
DROP POLICY IF EXISTS "EventType_tw_owner_read"  ON "public"."EventType";
DROP POLICY IF EXISTS "Booking_tw_owner_read"    ON "public"."Booking";
DROP POLICY IF EXISTS "Schedule_tw_owner_read"   ON "public"."Schedule";
DROP POLICY IF EXISTS "Credential_tw_owner_read" ON "public"."Credential";

ALTER TABLE "public"."users"      ALTER COLUMN "twOrgId" DROP DEFAULT;
ALTER TABLE "public"."EventType"  ALTER COLUMN "twOrgId" DROP DEFAULT;
ALTER TABLE "public"."Booking"    ALTER COLUMN "twOrgId" DROP DEFAULT;
ALTER TABLE "public"."Schedule"   ALTER COLUMN "twOrgId" DROP DEFAULT;
ALTER TABLE "public"."Credential" ALTER COLUMN "twOrgId" DROP DEFAULT;
