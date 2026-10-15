-- TW-T9.2b2f (WC-PE-6 timeway, expand step): two more pre-tenant lookups.
-- Additive and idempotent: two new functions, no table, policy or row is touched.
-- Same contract as 20261014120000_tw_t9_2a_pre_tenant_lookups: SECURITY DEFINER,
-- search_path pinned, owned by timeway_owner, ids and org only, EXECUTE for
-- timeway_app only.
--
--   * tw_resolve_org_for_event_type_id: the booker's slot procedures
--     (slots.reserveSlot, slots.isAvailable, slots.removeSelectedSlotMark) carry only
--     an eventTypeId.
--   * tw_resolve_org_for_seat_reference: /booking/[uid] and /reschedule/[uid] accept a
--     seat referenceUid. BookingSeat has no twOrgId, so the org is the seat's
--     Booking."twOrgId"; the join runs as the owner, so it still works once FORCE RLS
--     is on Booking (TW-T9.2d).

CREATE OR REPLACE FUNCTION public.tw_resolve_org_for_event_type_id(p_id integer)
RETURNS TABLE (id integer, "twOrgId" uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT e.id, e."twOrgId" FROM public."EventType" e WHERE e.id = p_id
$$;

-- id is the BookingSeat id; the org is that of the booking the seat belongs to.
CREATE OR REPLACE FUNCTION public.tw_resolve_org_for_seat_reference(p_ref text)
RETURNS TABLE (id integer, "twOrgId" uuid)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT s.id, b."twOrgId"
  FROM public."BookingSeat" s
  JOIN public."Booking" b ON b.id = s."bookingId"
  WHERE s."referenceUid" = p_ref
$$;

DO $$
DECLARE
  f text;
  fns text[] := ARRAY[
    'public.tw_resolve_org_for_event_type_id(integer)',
    'public.tw_resolve_org_for_seat_reference(text)'
  ];
BEGIN
  FOREACH f IN ARRAY fns LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
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
