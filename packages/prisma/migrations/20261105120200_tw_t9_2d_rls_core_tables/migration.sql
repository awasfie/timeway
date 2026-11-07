-- TW-T9.2d (WC-PE-6 timeway slice 2, proof CC-89 line): row-level security on the five
-- org-scoped Cal.com tables, and the NULLIF form on all eight TW-T9 policies.
--
-- Lands after: TW-T9.2a org context (ALS + Prisma extension sets app.tw_org_id /
-- app.tw_platform per transaction), TW-T9.2b entry-point wiring, TW-T9.2c twOrgId backfill.
-- No row is read or written by this migration. Idempotent: safe to apply twice.
-- Rollback: scripts/tw-t9/rls-2d-down.sql (DISABLE RLS + DROP POLICY on these five only).
--
-- Policy (USING and WITH CHECK, one per table, all commands, PUBLIC):
--   current_setting('app.tw_platform', true) = 'on'
--   OR "<org col>" = NULLIF(current_setting('app.tw_org_id', true), '')::uuid
-- NULLIF turns a released setting ('' on a reused backend) into NULL, so the comparison
-- is NULL (not a cast error) and the row is invisible. Rows with a NULL twOrgId are
-- invisible to timeway_app outside a platform scope or a SECURITY DEFINER lookup.

-- 1. Five Cal.com tables: ENABLE + FORCE, one isolation policy each.
ALTER TABLE "public"."users"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."users"      FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."EventType"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."EventType"  FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."Booking"    ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Booking"    FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."Schedule"   ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Schedule"   FORCE ROW LEVEL SECURITY;
ALTER TABLE "public"."Credential" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."Credential" FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_tw_org_isolation" ON "public"."users";
CREATE POLICY "users_tw_org_isolation" ON "public"."users"
  USING (current_setting('app.tw_platform', true) = 'on'
         OR "twOrgId" = NULLIF(current_setting('app.tw_org_id', true), '')::uuid)
  WITH CHECK (current_setting('app.tw_platform', true) = 'on'
         OR "twOrgId" = NULLIF(current_setting('app.tw_org_id', true), '')::uuid);

DROP POLICY IF EXISTS "EventType_tw_org_isolation" ON "public"."EventType";
CREATE POLICY "EventType_tw_org_isolation" ON "public"."EventType"
  USING (current_setting('app.tw_platform', true) = 'on'
         OR "twOrgId" = NULLIF(current_setting('app.tw_org_id', true), '')::uuid)
  WITH CHECK (current_setting('app.tw_platform', true) = 'on'
         OR "twOrgId" = NULLIF(current_setting('app.tw_org_id', true), '')::uuid);

DROP POLICY IF EXISTS "Booking_tw_org_isolation" ON "public"."Booking";
CREATE POLICY "Booking_tw_org_isolation" ON "public"."Booking"
  USING (current_setting('app.tw_platform', true) = 'on'
         OR "twOrgId" = NULLIF(current_setting('app.tw_org_id', true), '')::uuid)
  WITH CHECK (current_setting('app.tw_platform', true) = 'on'
         OR "twOrgId" = NULLIF(current_setting('app.tw_org_id', true), '')::uuid);

DROP POLICY IF EXISTS "Schedule_tw_org_isolation" ON "public"."Schedule";
CREATE POLICY "Schedule_tw_org_isolation" ON "public"."Schedule"
  USING (current_setting('app.tw_platform', true) = 'on'
         OR "twOrgId" = NULLIF(current_setting('app.tw_org_id', true), '')::uuid)
  WITH CHECK (current_setting('app.tw_platform', true) = 'on'
         OR "twOrgId" = NULLIF(current_setting('app.tw_org_id', true), '')::uuid);

DROP POLICY IF EXISTS "Credential_tw_org_isolation" ON "public"."Credential";
CREATE POLICY "Credential_tw_org_isolation" ON "public"."Credential"
  USING (current_setting('app.tw_platform', true) = 'on'
         OR "twOrgId" = NULLIF(current_setting('app.tw_org_id', true), '')::uuid)
  WITH CHECK (current_setting('app.tw_platform', true) = 'on'
         OR "twOrgId" = NULLIF(current_setting('app.tw_org_id', true), '')::uuid);

-- 2. SELECT-only policy for the owner role, so the TW-T9.2a/2b2f SECURITY DEFINER lookups
--    (owned by timeway_owner, run as timeway_owner) still read under FORCE RLS
--    (salesos#159 pattern). timeway_app is not a member of timeway_owner (harness R1),
--    and the owner can disable RLS anyway, so this opens nothing to the runtime role.
--    Skipped where the role does not exist (dev databases without the prod roles).
DO $$
DECLARE
  t text;
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'timeway_owner') THEN
    FOREACH t IN ARRAY ARRAY['users', 'EventType', 'Booking', 'Schedule', 'Credential'] LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tw_owner_read', t);
      EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO timeway_owner USING (true)',
                     t || '_tw_owner_read', t);
    END LOOP;
  END IF;
END
$$;

-- 3. A row created inside an org scope belongs to that org: the column default reads the
--    same setting. Cal.com create paths do not set twOrgId; without this default every
--    insert in an org scope would carry NULL and fail WITH CHECK. Outside a scope the
--    default is NULL, as before. Explicit values still go through WITH CHECK.
ALTER TABLE "public"."users"      ALTER COLUMN "twOrgId" SET DEFAULT NULLIF(current_setting('app.tw_org_id', true), '')::uuid;
ALTER TABLE "public"."EventType"  ALTER COLUMN "twOrgId" SET DEFAULT NULLIF(current_setting('app.tw_org_id', true), '')::uuid;
ALTER TABLE "public"."Booking"    ALTER COLUMN "twOrgId" SET DEFAULT NULLIF(current_setting('app.tw_org_id', true), '')::uuid;
ALTER TABLE "public"."Schedule"   ALTER COLUMN "twOrgId" SET DEFAULT NULLIF(current_setting('app.tw_org_id', true), '')::uuid;
ALTER TABLE "public"."Credential" ALTER COLUMN "twOrgId" SET DEFAULT NULLIF(current_setting('app.tw_org_id', true), '')::uuid;

-- 4. Slice-1 policies to the NULLIF form (harness T3 was 0/3). Same semantics for a set
--    org id; a released '' setting now compares as NULL instead of matching nothing by text.
ALTER POLICY "tw_organization_isolation" ON "public"."tw_organization"
  USING (current_setting('app.tw_platform', true) = 'on'
         OR "id" = NULLIF(current_setting('app.tw_org_id', true), '')::uuid)
  WITH CHECK (current_setting('app.tw_platform', true) = 'on'
         OR "id" = NULLIF(current_setting('app.tw_org_id', true), '')::uuid);

ALTER POLICY "tw_organization_member_isolation" ON "public"."tw_organization_member"
  USING (current_setting('app.tw_platform', true) = 'on'
         OR "orgId" = NULLIF(current_setting('app.tw_org_id', true), '')::uuid)
  WITH CHECK (current_setting('app.tw_platform', true) = 'on'
         OR "orgId" = NULLIF(current_setting('app.tw_org_id', true), '')::uuid);

ALTER POLICY "tw_org_api_key_isolation" ON "public"."tw_org_api_key"
  USING (current_setting('app.tw_platform', true) = 'on'
         OR "orgId" = NULLIF(current_setting('app.tw_org_id', true), '')::uuid)
  WITH CHECK (current_setting('app.tw_platform', true) = 'on'
         OR "orgId" = NULLIF(current_setting('app.tw_org_id', true), '')::uuid);
