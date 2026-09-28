# TW-T9 — Timeway Organizations (Bible v12.3 PART TW / Q2-B)

Timeway owns its own multi-tenant model (D-R37, CH-11). This is original work;
no cal.com EE code (TW.LEGAL). Upstream's `Team`-based "organizations" are not
used for this layer.

## Slices (expand → backfill → contract)

| Slice | What | Status |
|---|---|---|
| 1 | `tw_organization`, `tw_organization_member`, `tw_org_api_key` + enums; RLS **forced** on all three; CC-13 DB-layer probe in CI | this PR |
| 2 | Prisma client extension + service-layer org context (from session / API key only, never client params) setting `app.tw_org_id` per transaction | next |
| 3 | Expand: nullable `organizationId` (UUID) on users / EventType / Booking / Schedule / Credential, indexed | next |
| 4 | Backfill: `spenai-pilot` org, existing rows assigned (runs on live DB = effect step, Ahmed/Gosi) | effect |
| 5 | Contract: non-null on org-scoped rows; CC-13 extended to pages, tRPC, API v2, webhook config | later |
| + | Team/TeamMember, Plan + OrgEntitlementOverride land with TW-T11 / TW-T12 | later |

## RLS contract

A row in a TW-T9 table is visible/writable only when the current transaction set
`app.tw_org_id` to its org (`set_config('app.tw_org_id', <uuid>, true)`), or when
trusted platform code set `app.tw_platform = 'on'` (provisioning, TW-T10). With
neither, every query returns zero rows (fail-closed). Superuser / table-owner
connections bypass RLS, so the app must connect as a non-owner role before the
backfill slice; that role change is recorded as an effect step.

## Proof

`packages/prisma/conformance/cc13-org-isolation.mjs`, run by
`.github/workflows/cc13-org-isolation.yml` on every PR touching `packages/prisma`.
It refuses anything but a local throwaway Postgres.

## Migration safety

`20260928020000_tw_t9_organizations` is additive (new types + tables only). It is
**not** applied to the live `timeway` DB by this PR; applying it is a deploy/migration
effect step (D-R63-2).
