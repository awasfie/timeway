# TW-T9 entry points and their org context (TW-T9.2b4)

Card t_d8d8e6e9 (split 4/4 of TW-T9.2b, t_2498dd01). Sections: Q-3, WC-30 step 5, CC-13.
Sources: #51 (2b1 authed, `tw-org-scope/session.ts`), #54 (2b2 public, `public.ts`), #55 (2b3 unattended, `unattended.ts`), plus the one gap this audit found (Camv booking window, row 22).

Context sources:
- session: the signed NextAuth JWT `twOrgId`, or in API v2 the user row the guards verified. A NULL org opens no scope.
- api-key: an API v2 API key or access token owner (the v2 guard verifies it, then the interceptor uses that user's org).
- resolver fn: a 2a SECURITY DEFINER function (`tw_resolve_*`). It must give exactly one non-NULL org, or the request gets 404 / notFound / no work.
- platform:'<reason>': `runWithTwPlatform`. Reasons are fixed in `TW_UNATTENDED_PLATFORM_REASONS` or named at the call site.

No entry point reads an org from a request param, header, query, body or tRPC input (CC-13).

CI enforcement: `packages/lib/server/tw-org-scope/entrypoints.test.ts` runs in the Unit job (`yarn test`). Any file under `apps/web/app/api/**/route.ts`, `apps/web/pages/api/**`, `apps/api/v2/src/**/*.controller.ts` or `packages/app-store/*/api/**` (crons under `apps/web/app/api/cron/**` included) that imports the prisma client must pass one of these checks:
- it imports `tw-org-scope/*`;
- it goes through `defaultResponder` / `defaultResponderForAppDir` (both wrap with `withSessionTwOrg`);
- it is a v2 controller (global interceptor);
- it is an app-store handler reached only via `integrations/[...args]`.
Anything else must be listed in `scripts/tw-t9/entrypoint-allowlist.json` with a reason. Unlisted files and stale entries both fail the test. The allowlist is currently empty.

| # | Entry point (path) | Surface | Context source |
|---|---|---|---|
| 1 | `packages/features/auth/lib/next-auth-options.ts` credentials `authorize` (`/api/auth/[...nextauth]`) | authed | resolver fn `tw_resolve_user_for_login(email)`, then session org |
| 2 | same file, `signIn` callback | authed | org from authorize; otherwise `tw_resolve_user_for_login`; otherwise platform:'nextauth-oauth-link' (twOrgId-only read by IdP id) |
| 3 | same file, `jwt` callback and `jwt.encode` | authed | session (org written to the token at sign-in, never from `update()` data) |
| 4 | same file, `session` callback | authed | session |
| 5 | same file, adapter `getUser`, `getUserByEmail`, `getUserByAccount`, `updateUser`, `linkAccount` | authed | resolver fn (email), or platform:'nextauth-oauth-link' (user id / account, twOrgId only) |
| 6 | `packages/features/auth/lib/getServerSession.ts` (pages + app router) | authed | session |
| 7 | tRPC, every procedure (`packages/trpc/server/trpc.ts` base procedure, `middlewares/twOrgScopeMiddleware.ts`), served by `apps/web/pages/api/trpc/*/[trpc].ts` | authed | session (ctx session, else the signed cookie) |
| 8 | `apps/web/app/api/**/route.ts` via `defaultResponderForAppDir` (`apps/web/app/api/defaultResponderForAppDir.ts`) | authed | session |
| 9 | `apps/web/pages/api/**` via `defaultResponder` (`packages/lib/server/defaultResponder.ts`) | authed | session |
| 10 | `apps/web/pages/api/integrations/[...args].ts` and the `packages/app-store/*/api/*` handlers it dispatches (add, callback, etc.) | authed | session |
| 11 | `apps/api/v2/src/**/*.controller.ts`, every HTTP handler (global `TwOrgScopeInterceptor`, `apps/api/v2/src/app.module.ts`) | authed | session / api-key (guard-verified `request.user.twOrgId`) |
| 12 | API v2 guard principal lookups (`api-auth.strategy.ts`, `next-auth.strategy.ts`, OAuth client) | authed | platform:'api-v2-auth-principal' |
| 13 | API v2 `PrismaReadService` / `PrismaWriteService` | authed | carries rows 11-12 to the DB (`withTwOrgScope()`) |
| 14 | `/[user]/[type]` (+embed, dynamic groups): `apps/web/server/lib/[user]/[type]/getServerSideProps.ts` | public | resolver fn `tw_resolve_org_for_user_slug` (every username, one org) |
| 15 | `/team/[slug]/[type]` (+embed): `apps/web/lib/team/[slug]/[type]/getServerSideProps.tsx` | public | resolver fn `tw_resolve_org_for_team_slug` |
| 16 | `/booking/[uid]` (+embed): `apps/web/modules/bookings/views/bookings-single-view.getServerSideProps.tsx` | public | resolver fn `tw_resolve_org_for_booking_uid` (uid, then the seat's booking uid) |
| 17 | `/reschedule/[uid]` (+embed): `apps/web/lib/reschedule/[uid]/getServerSideProps.ts` | public | resolver fn `tw_resolve_org_for_booking_uid` |
| 18 | `apps/web/app/api/cancel/route.ts` (POST, DELETE) | public | resolver fn `tw_resolve_org_for_booking_uid` |
| 19 | `apps/web/pages/api/book/event.ts` | public | resolver fn `tw_resolve_org_for_user_slug`; a single key falls back to `tw_resolve_org_for_team_slug` |
| 20 | `apps/web/pages/api/book/recurring-event.ts` | public | resolver fn, as row 19 (first slot body) |
| 21 | tRPC `slots.getSchedule` (`packages/trpc/server/routers/viewer/slots/_router.tsx`) | public | resolver fn `tw_resolve_org_for_team_slug` if `isTeamEvent`, else `tw_resolve_org_for_user_slug` |
| 22 | `apps/web/app/api/camv/booking-window/[uid]/route.ts` (Camv server-to-server, shared-secret header) | public | resolver fn `tw_resolve_org_for_booking_uid` (added by this card; it was unscoped) |
| 23 | `apps/web/app/api/cron/bookingReminder/route.ts` | unattended | platform:'bookingReminder' |
| 24 | `apps/web/app/api/cron/calendar-subscriptions/route.ts` | unattended | platform:'calendar-subscriptions' |
| 25 | `apps/web/app/api/cron/calendar-subscriptions-cleanup/route.ts` | unattended | platform:'calendar-subscriptions-cleanup' |
| 26 | `apps/web/app/api/cron/changeTimeZone/route.ts` | unattended | platform:'changeTimeZone' |
| 27 | `apps/web/app/api/cron/selected-calendars/route.ts` | unattended | platform:'selected-calendars' |
| 28 | `apps/web/app/api/cron/syncAppMeta/route.ts` | unattended | platform:'syncAppMeta' |
| 29 | `apps/web/app/api/cron/webhookTriggers/route.ts` | unattended | platform:'webhookTriggers' |
| 30 | `apps/web/app/api/tasks/cron/route.ts` | unattended | platform:'tasks-cron' |
| 31 | `apps/web/app/api/tasks/cleanup/route.ts` | unattended | platform:'tasks-cleanup' |
| 32 | `apps/web/app/api/webhooks/calendar-subscription/[provider]/route.ts` | unattended | resolver fn: SelectedCalendar.credentialId -> `tw_resolve_org_for_credential`; no org -> 200 ack, no work |
| 33 | `apps/web/app/api/webhook/app-credential/route.ts` | unattended | platform:'app-credential-webhook' |
| 34 | `packages/app-store/alby/api/webhook.ts` (via `apps/web/pages/api/integrations/alby/webhook.ts`) | unattended | platform:'alby-webhook' |
| 35 | `packages/app-store/btcpayserver/api/webhook.ts` (via `apps/web/pages/api/integrations/btcpayserver/webhook.ts`) | unattended | platform:'btcpayserver-webhook' |
| 36 | `packages/app-store/hitpay/api/webhook.ts` | unattended | platform:'hitpay-webhook' |
| 37 | `packages/app-store/paypal/api/webhook.ts` (via `apps/web/pages/api/integrations/paypal/webhook.ts`) | unattended | platform:'paypal-webhook' |
| 38 | `packages/app-store/vital/api/webhook.ts` | unattended | platform:'vital-webhook' |
| 39 | `apps/web/pages/api/stripe/webhook.ts`, `apps/web/pages/api/integrations/stripepayment/webhook.ts` | unattended | none needed: community-edition 404 stubs with no DB access |

Known gaps (fail closed once RLS is on; tracked on t_6674115f, a parent of the RLS card t_c7fb086a):
- `slots.reserveSlot`, `slots.isAvailable` and `slots.removeSelectedSlotMark` take only an eventTypeId or reservation uid, and no resolver exists for those yet.
- A seat `referenceUid` link resolves only through its booking uid.
