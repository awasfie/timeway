-- TW-T9 signup org (t_9824b7a7, Q-18): every user gets a tw org, so FORCE RLS (TW-T9.2d)
-- never leaves a webapp signup platform-only.
--
-- public.tw_ensure_user_org(user_id) -> uuid, idempotent:
--   1. users.twOrgId already set            -> keep it.
--   2. exactly one tw_organization_member   -> that org.
--   3. no member row, accepted team co-members holding exactly one org (same rule as the
--      TW-T9.2c backfill inherit step, t_96c0a301) -> member row (role member) for that org.
--   4. otherwise (no team, or team members hold no org) -> a personal org, slug
--      'personal-<userId>', with the user as owner.
--   >1 candidate org (step 2 or 3) -> returns NULL and changes nothing (operator decides).
--   Then stamps users.twOrgId and the user's own NULL-org Schedule, Credential, EventType
--   (userId) and Booking (userId; the event type's org first, as in the backfill).
--
-- SECURITY INVOKER on purpose: it opens nothing. The caller must already be in a platform
-- scope (app.tw_platform = 'on'; the app calls it through withTwPlatform with reason
-- 'tw-user-org-provision', the backfill script sets it itself); otherwise it raises 42501.
-- Additive only: one function, no table change, no row touched by this migration.
CREATE OR REPLACE FUNCTION public.tw_ensure_user_org(p_user_id integer)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_org      uuid;
  v_n        integer;
  v_name     text;
  v_username text;
  v_slug     text := 'personal-' || p_user_id;
BEGIN
  IF coalesce(current_setting('app.tw_platform', true), '') <> 'on' THEN
    RAISE EXCEPTION 'tw_ensure_user_org runs only in a platform scope' USING ERRCODE = '42501';
  END IF;

  SELECT u."twOrgId", u.name, u.username INTO v_org, v_name, v_username
  FROM public.users u WHERE u.id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_org IS NULL THEN
    SELECT count(DISTINCT m."orgId"), min(m."orgId"::text)::uuid INTO v_n, v_org
    FROM public.tw_organization_member m WHERE m."userId" = p_user_id;
    IF v_n > 1 THEN
      RETURN NULL;
    END IF;

    IF v_n = 0 THEN
      SELECT count(DISTINCT om."orgId"), min(om."orgId"::text)::uuid INTO v_n, v_org
      FROM public."Membership" me
      JOIN public."Membership" co
        ON co."teamId" = me."teamId" AND co.accepted AND co."userId" <> me."userId"
      JOIN public.tw_organization_member om ON om."userId" = co."userId"
      WHERE me."userId" = p_user_id AND me.accepted;
      IF v_n > 1 THEN
        RETURN NULL;
      END IF;

      IF v_n = 1 THEN
        INSERT INTO public.tw_organization_member (id, "orgId", "userId", role)
        VALUES (gen_random_uuid(), v_org, p_user_id, 'member')
        ON CONFLICT ("orgId", "userId") DO NOTHING;
      ELSE
        INSERT INTO public.tw_organization (id, slug, name, "updatedAt")
        VALUES (gen_random_uuid(), v_slug,
                coalesce(nullif(btrim(v_name), ''), nullif(btrim(v_username), ''), 'Personal'), now())
        ON CONFLICT (slug) DO NOTHING;
        SELECT o.id INTO v_org FROM public.tw_organization o WHERE o.slug = v_slug;
        -- The slug is reserved for this user: an org under it with any other member is not theirs.
        IF EXISTS (SELECT 1 FROM public.tw_organization_member x
                   WHERE x."orgId" = v_org AND x."userId" <> p_user_id) THEN
          RAISE EXCEPTION 'tw org slug % is held by another member', v_slug USING ERRCODE = '23505';
        END IF;
        INSERT INTO public.tw_organization_member (id, "orgId", "userId", role)
        VALUES (gen_random_uuid(), v_org, p_user_id, 'owner')
        ON CONFLICT ("orgId", "userId") DO NOTHING;
      END IF;
    END IF;

    UPDATE public.users SET "twOrgId" = v_org WHERE id = p_user_id;
  END IF;

  UPDATE public."Schedule"   SET "twOrgId" = v_org WHERE "userId" = p_user_id AND "twOrgId" IS NULL;
  UPDATE public."Credential" SET "twOrgId" = v_org WHERE "userId" = p_user_id AND "twOrgId" IS NULL;
  UPDATE public."EventType"  SET "twOrgId" = v_org WHERE "userId" = p_user_id AND "twOrgId" IS NULL;
  UPDATE public."Booking" b
     SET "twOrgId" = coalesce((SELECT e."twOrgId" FROM public."EventType" e WHERE e.id = b."eventTypeId"), v_org)
   WHERE b."userId" = p_user_id AND b."twOrgId" IS NULL;

  RETURN v_org;
END
$$;

COMMENT ON FUNCTION public.tw_ensure_user_org(integer) IS
  'TW-T9 (t_9824b7a7): idempotent org provisioning for one user; SECURITY INVOKER, platform scope required.';
