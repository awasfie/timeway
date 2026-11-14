# Provisioning + org API (TW-T10, CC-14)

Base: `https://timeway.co/api/v2/orgs`. JSON in, JSON out, `cache-control: no-store`.
Errors: `{"error":{"code":"...","message":"..."}}`.

Auth: `Authorization: Bearer <key>`.

- Platform master key (`TW_PLATFORM_MASTER_KEY`, Coolify secret, min 24 chars): `POST /orgs` only.
- Org key (`twk_<8 hex>.<48 hex>`): everything under `/orgs/{orgId}/...`, limited by scopes. Stored as prefix + sha256, compared in constant time, revocable (`revokedAt`).
- The org is always the key's org. A path `orgId` that is not the key's org answers 404 on every verb (no existence oracle).
- Rate limit: 120 requests/minute per key (process-local fixed window), `429 rate_limited`.

Default org key scopes: `orgs:read orgs:write members:write event-types:write bookings:read webhooks:write`.

## POST /orgs  (platform key)

Idempotent on `external_ref` (unique index). First call: `201`, creates in one transaction the org,
an owner user, a default schedule (Mon-Fri 09:00-17:00 unless `working_hours`), two event types
(`discovery` 15 min, `demo` 30 min, location Camv/LiveKit) and an org API key. The raw key is in the
response once. Replay with the same `external_ref`: `200`, same org, no key, missing defaults filled
(crash-resume). Concurrent creates: one `201`, the other `200`.

Request:

    {
      "external_ref": "tenant-74c6f0c1",
      "name": "Acme Dental",
      "slug": "acme-dental",                       // optional; 409 slug_taken if used
      "plan_code": "pro",                          // optional
      "owner": {"email": "owner@acme.test", "name": "Sara", "username": "sara", "timezone": "Asia/Dubai"},
      "working_hours": {"days": [0,1,2,3,4], "start": "09:00", "end": "17:00"}   // optional, 0 = Sunday
    }

Response `201`:

    {
      "org": {"id": "uuid", "slug": "acme-dental", "name": "Acme Dental", "externalRef": "tenant-74c6f0c1",
              "status": "active", "planCode": "pro",
              "owner": {"userId": 123, "email": "owner@acme.test", "username": "sara"},
              "eventTypes": [{"id": 1, "slug": "discovery", "length": 15}, {"id": 2, "slug": "demo", "length": 30}]},
      "api_key": {"id": "uuid", "prefix": "twk_ab12cd34", "raw": "twk_ab12cd34.<48 hex>", "scopes": ["orgs:read", "..."]}
    }

Errors: 400 invalid_request, 401, 403 (org key), 409 slug_taken / owner_email_in_use.

## Org-scoped (org key)

| Verb path | Scope | Notes |
|---|---|---|
| GET /orgs/{orgId} | orgs:read | |
| GET /orgs/{orgId}/members | members:write or orgs:read | `{members:[{role,managed,user}]}` |
| POST /orgs/{orgId}/members | members:write | `{email,name?,username?,role?: member\|admin}`; created user is `managed=true`; 201 new, 200 replay; 409 email_in_use if the email belongs to another org |
| GET /orgs/{orgId}/event-types | orgs:read | |
| POST /orgs/{orgId}/event-types | event-types:write | `{title,slug,length(5-720),owner_user_id?}`; 409 on duplicate slug |
| GET /orgs/{orgId}/slots?eventTypeId&start&end&timezone | bookings:read | same engine as the public booker; range <= 62 days |
| GET /orgs/{orgId}/bookings?status&limit | bookings:read | limit <= 200 |
| GET/POST /orgs/{orgId}/webhooks, DELETE .../{id} | webhooks:write | `{subscriber_url (https), triggers[], secret?}`; secret never echoed |

Webhook triggers: `BOOKING_CREATED BOOKING_RESCHEDULED BOOKING_CANCELLED BOOKING_REQUESTED BOOKING_REJECTED BOOKING_NO_SHOW_UPDATED MEETING_STARTED MEETING_ENDED`.

Note: webhook rows have no `twOrgId` column (upstream table); membership is via the org's member users.
A later contract slice may add one.

## Proof

`apps/web/test/tw-t10/provisioning.integration-test.ts` (CC-14): same `external_ref` twice -> one org;
concurrent double-create; crash-resume; full default resources; org-A key on org-B -> 404 on all resources;
scopes; revoked key; rate limit. Runs green as a non-superuser DB role, so RLS is in force.
