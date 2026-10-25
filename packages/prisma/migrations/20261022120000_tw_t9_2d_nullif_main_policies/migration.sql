-- TW-T9.2d follow-up: the two org policies that landed on main after TW-T9.2d was written
-- (WC-TW-12b tw_custom_hostname, WC-TW-9b tw_activation_event) to the NULLIF form, so all
-- TW-T9 policies read app.tw_org_id the same way (CC-89 harness T3).
-- Same semantics for a set org id; a released '' setting compares as NULL. No row is read
-- or written. Idempotent (ALTER POLICY replaces the expressions).

ALTER POLICY "tw_custom_hostname_isolation" ON "public"."tw_custom_hostname"
  USING (current_setting('app.tw_platform', true) = 'on'
         OR "orgId" = NULLIF(current_setting('app.tw_org_id', true), '')::uuid)
  WITH CHECK (current_setting('app.tw_platform', true) = 'on'
         OR "orgId" = NULLIF(current_setting('app.tw_org_id', true), '')::uuid);

ALTER POLICY "tw_activation_event_isolation" ON "public"."tw_activation_event"
  USING (current_setting('app.tw_platform', true) = 'on'
         OR "twOrgId" = NULLIF(current_setting('app.tw_org_id', true), '')::uuid)
  WITH CHECK (current_setting('app.tw_platform', true) = 'on'
         OR "twOrgId" = NULLIF(current_setting('app.tw_org_id', true), '')::uuid);
