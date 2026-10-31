-- TW-T9.2a (WC-PE-6 timeway, expand step): pre-tenant lookups.
-- Additive and idempotent: five new functions, no table, policy or row is touched,
-- and no RLS is enabled here (that is TW-T9.2d).
--
-- Login, public booking pages, booking-uid links and credential callbacks must find
-- the org BEFORE a tenant scope exists. Once RLS is on, the runtime role
-- (timeway_app) sees nothing without app.tw_org_id, so these reads go through
-- SECURITY DEFINER functions instead:
--   * owned by timeway_owner (the migration role), search_path pinned;
--   * they read as timeway_owner. When TW-T9.2d enables FORCE RLS on these tables it
--     adds a SELECT-only policy `TO timeway_owner USING (true)` (salesos#159 pattern):
--     the owner can disable RLS anyway, and timeway_app is not a member of it, so that
--     opens nothing to the runtime role. (A function-level `SET app.tw_platform` is not
--     an option: Postgres refuses custom GUCs in proconfig for a non-superuser owner.)
--   * they return ids and the org only, never a password, token or credential key;
--   * EXECUTE is revoked from PUBLIC and granted to timeway_app only.
-- Rows whose twOrgId is NULL come back with a NULL org: the caller decides (platform
-- scope or refuse); the runtime role cannot reach those rows directly.

CREATE OR REPLACE FUNCTION public.tw_resolve_user_for_login(p_email text)
RETURNS TABLE (id integer, "twOrgId" uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT u.id, u."twOrgId" FROM public.users u WHERE u.email = lower(p_email)
$$;

-- username is unique per upstream organizationId, not globally: may return several rows.
CREATE OR REPLACE FUNCTION public.tw_resolve_org_for_user_slug(p_username text)
RETURNS TABLE (id integer, "twOrgId" uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT u.id, u."twOrgId" FROM public.users u WHERE u.username = p_username
$$;

-- Team carries no twOrgId: the org is that of its accepted members (normally one).
CREATE OR REPLACE FUNCTION public.tw_resolve_org_for_team_slug(p_slug text)
RETURNS TABLE (id integer, "twOrgId" uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT DISTINCT t.id, u."twOrgId"
  FROM public."Team" t
  JOIN public."Membership" m ON m."teamId" = t.id AND m.accepted
  JOIN public.users u ON u.id = m."userId"
  WHERE t.slug = p_slug
$$;

CREATE OR REPLACE FUNCTION public.tw_resolve_org_for_booking_uid(p_uid text)
RETURNS TABLE (id integer, "twOrgId" uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT b.id, b."twOrgId" FROM public."Booking" b WHERE b.uid = p_uid
$$;

CREATE OR REPLACE FUNCTION public.tw_resolve_org_for_credential(p_id integer)
RETURNS TABLE (id integer, "twOrgId" uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT c.id, c."twOrgId" FROM public."Credential" c WHERE c.id = p_id
$$;

DO $$
DECLARE
  f text;
  fns text[] := ARRAY[
    'public.tw_resolve_user_for_login(text)',
    'public.tw_resolve_org_for_user_slug(text)',
    'public.tw_resolve_org_for_team_slug(text)',
    'public.tw_resolve_org_for_booking_uid(text)',
    'public.tw_resolve_org_for_credential(integer)'
  ];
BEGIN
  FOREACH f IN ARRAY fns LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    -- Production migrates as timeway_owner already; a database migrated by another
    -- role hands the functions over when it can (fresh dev/CI databases without the
    -- role keep the migrator as owner).
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'timeway_owner')
       AND current_user <> 'timeway_owner'
       AND pg_has_role(current_user, 'timeway_owner', 'MEMBER') THEN
      EXECUTE format('ALTER FUNCTION %s OWNER TO timeway_owner', f);
    END IF;
    IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'timeway_app') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO timeway_app', f);
    END IF;
  END LOOP;
END
$$;
