# WC-TW-14f proof: CC-14 extended, sandbox unbilled, billing attribution

Card t_68d9f847. Local Postgres 16 (`tw_t14f`, all 14b/14c migrations applied by `prisma migrate deploy`), Timeway code at
the merge of 14b (`ad7debaf11`, PR #241) and 14c (`b4711c2584`, PR #157). No staging, no Passport, no prod.

## Command

    createdb tw_t14f
    DATABASE_URL=postgresql://<user>@127.0.0.1:5432/tw_t14f DATABASE_DIRECT_URL=<same> npx prisma migrate deploy --schema packages/prisma/schema.prisma
    TW_API_USAGE_ENABLED=true is set by the test; run:
    VITEST_MODE=integration npx vitest run apps/web/test/tw-t10/wc-tw-14f.integration-test.ts --disableConsoleIntercept

Result: 1 file, 5 tests passed. After the run `tw_organization` = 0 rows and `Task` = 0 rows (the test deletes
exactly what it created).

## Output (PROOF lines, verbatim)

    step1a orgs POST x2 -> statuses 201,200; same id; organization rows with that external_ref = 1
    step1b sub-org concurrent x2 + replay -> created flags [false,true]+false, rows with parent = 1, externalRef sub:<parent>:c1; different body -> 409
    step1c crash-resume before {"orgs":1,"members":0,"schedules":0,"eventTypes":0} -> after replay {"orgs":1,"members":1,"schedules":1,"eventTypes":2}; second replay unchanged
    step2 sandbox parent+child: managed members=5, API bookings=2 (outcomes unbilled,unbilled), snapshot={"enabled":true,"billingOrgs":0,"enqueued":0,...}, outbox lines for these orgs = 0
    step3 outbox: 2 lines for billing org; mu={key tw-api:timeway_api_managed_user:<day>:mu:<parent>, value 1, orgId <parent>, clientOrgId null}; bk={key tw-api:timeway_api_booking:bk:<uid>, value 1, orgId <parent>, clientOrgId <sub-org>}; snapshot rerun enqueued=0 dup=1; booking replay outcome=duplicate

## Reading

1. CC-14 extended: same `external_ref` twice -> 201 then 200, one row. Sub-org same clientRef concurrently and again -> one row,
   stored externalRef `sub:<parentOrgId>:c1` (E3), different body -> 409. Crash-resume is simulated by seeding the state a
   crash between org insert and default resources leaves (org row only); the replay returns 200, same org id, and fills
   owner member, schedule and 2 default event types; a second replay changes nothing. (A process kill is not exercised; the
   seeded state is the one the ensureDefaults path resumes from.)
2. Sandbox: a sandbox parent and its child (isSandbox inherited) with 5 managed users and 2 API-created bookings produce 0
   outbox lines (booking outcome `unbilled`, snapshot enqueues nothing).
3. Parent-attributed sub-org: the booking line carries orgId = parent, clientOrgId = sub-org. The managed-user snapshot is ONE
   line per billing org with no clientOrgId (Gosi ruling from passport#42 on 14c, which replaces the per-client identifier
   in the card text, because Passport rejects clientOrgId on the `last` meter). Re-running the snapshot the same day and
   re-enqueueing the same booking add nothing (identifier is the Task referenceUid, unique).

## Not proven here

Passport leg of step 3 ("a re-sent line counts once" in Passport, test mode) was not run: no Passport test-mode key by name
is available to this run, and nothing was sent to Passport. Recorded at the outbox only, as the card allows; left as a
comment on 14d (t_38a33673).
