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

## Plans (TW-T12)

Catalog = Bible CM.3 (`free`, `pro`, `teams`, `business`); Spenai bundle = CM.7.

`PUT /api/v2/orgs/{orgId}/plan` (platform key only) — body is one of:

    { "spenai_package": "starter" | "growth" | "scale" }   # starter -> teams x3, growth -> business x10, scale -> business x30
    { "spenai_cancelled": true }                             # -> free (never deletes anything)
    { "plan_code": "free|pro|teams|business", "seats": 5 }   # seats optional

200 `{ "plan": { "plan_code": "teams", "seats": 3 } }`; replay with the same body is a no-op. Enterprise is custom: set it with `plan_code` + `seats` by hand.

`GET /api/v2/orgs/{orgId}/plan` (org key, `orgs:read`) returns the plan code and effective entitlements.

Gates: `POST /members` and `POST /event-types` answer `402` with `plan_limit_members` / `plan_limit_event_types` when the plan's limit is reached. Only the four catalog codes are metered; an org with no plan code (spenai-pilot, pre-T12 orgs) stays unmetered until a plan is assigned.

## Branding (TW-T13)

`GET /api/v2/orgs/{orgId}/branding` (scope `orgs:read`) and `PUT` (scope `orgs:write`), org key only.

```
PUT /api/v2/orgs/{orgId}/branding
{ "logo_url": "https://<booking-assets host>/org/acme.png", "brand_color": "#1a73e8", "dark_brand_color": "#8ab4f8" }
200 { "branding": { "logo_url": "...", "brand_color": "#1a73e8", "dark_brand_color": "#8ab4f8" } }
```

`null` clears a field. Colours must be 3 or 6 digit hex. `logo_url` must be https on a host listed in the `TW_BOOKING_ASSETS_HOSTS` env var (comma list; unset = no logo accepted). The public booking page reads the org from the event row's `twOrgId`, never from the request, and falls back to the default look for any field that is unset.

## Moving the shared `spenai-pilot` data into per-tenant orgs (TW-T13)

`scripts/tw-t13/migrate-pilot-bookings.sh --dry-run|--apply MAP.csv` (`username,org_slug` per tenant user). Moves the user, schedules, credentials, event types, bookings and membership row from `spenai-pilot` to the mapped org, per user in one transaction; aborts a user whose row counts drop; idempotent; prints before/after counts. Prod apply only from the deploy card after a verified backup <= 24 h.

## OpenAPI 3.1 (WC-TW-14e)

Hand-checked against `packages/features/tw-provisioning/orgApi.ts`, `subOrgs.ts`, `provision.ts` (the org API is
a custom router, not an API v2 Swagger controller, so there are no decorators to generate from). Covers
org create/read, org API keys, members (managed), sub-orgs and the plan read. The prose above stays the
reference for webhooks, event types, slots, bookings, branding and the pilot migration.
`packages/features/tw-provisioning/openapiDoc.test.ts` parses this block on every unit run.

There is no list-orgs verb: `GET /orgs` answers 405. There are no key-management endpoints: the org key is
minted once by `POST /orgs` (shown once in the response), is revocable in the database (`revokedAt`), and
is the only credential for everything under `/orgs/{orgId}`. A sub-org gets no key of its own; the parent
key manages it.

```yaml openapi
openapi: 3.1.0
info:
  title: Timeway provisioning and org API
  version: "1.0"
  description: Provision organisations and sub-organisations, manage managed users. Prices are not documented here.
servers:
  - url: https://timeway.co/api/v2
security:
  - orgKey: []
paths:
  /orgs:
    post:
      operationId: createOrg
      summary: Create an organisation (platform key). Idempotent on external_ref.
      security:
        - platformKey: []
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/ProvisionRequest" }
      responses:
        "201":
          description: Created. The raw org API key is in the response once.
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ProvisionResponse" }
        "200":
          description: Replay of the same external_ref. Same org, no api_key.
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ProvisionResponse" }
        "400": { $ref: "#/components/responses/Error" }
        "401": { $ref: "#/components/responses/Error" }
        "403": { $ref: "#/components/responses/Error" }
        "409": { $ref: "#/components/responses/Error" }
        "429": { $ref: "#/components/responses/Error" }
  /orgs/{orgId}:
    get:
      operationId: getOrg
      summary: Read the key's own organisation (scope orgs:read). Another org id is 404.
      parameters:
        - $ref: "#/components/parameters/orgId"
      responses:
        "200":
          description: The organisation.
          content:
            application/json:
              schema:
                type: object
                properties:
                  org: { type: object, additionalProperties: true }
        "401": { $ref: "#/components/responses/Error" }
        "403": { $ref: "#/components/responses/Error" }
        "404": { $ref: "#/components/responses/Error" }
        "429": { $ref: "#/components/responses/Error" }
  /orgs/{orgId}/members:
    get:
      operationId: listMembers
      summary: List members (scope members:write or orgs:read).
      parameters:
        - $ref: "#/components/parameters/orgId"
      responses:
        "200":
          description: Members.
          content:
            application/json:
              schema:
                type: object
                properties:
                  members:
                    type: array
                    items: { $ref: "#/components/schemas/Member" }
        "401": { $ref: "#/components/responses/Error" }
        "403": { $ref: "#/components/responses/Error" }
        "404": { $ref: "#/components/responses/Error" }
    post:
      operationId: addManagedMember
      summary: Add a managed user (scope members:write). Counts toward the managed-user meter.
      parameters:
        - $ref: "#/components/parameters/orgId"
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [email]
              properties:
                email: { type: string, format: email }
                name: { type: string }
                username: { type: string }
                role: { type: string, enum: [member, admin] }
      responses:
        "201": { description: Created. }
        "200": { description: Replay, same member. }
        "400": { $ref: "#/components/responses/Error" }
        "402": { $ref: "#/components/responses/Error" }
        "403": { $ref: "#/components/responses/Error" }
        "404": { $ref: "#/components/responses/Error" }
        "409": { $ref: "#/components/responses/Error" }
  /orgs/{orgId}/plan:
    get:
      operationId: getPlan
      summary: Plan code and effective entitlements (scope orgs:read).
      parameters:
        - $ref: "#/components/parameters/orgId"
      responses:
        "200": { description: The plan. }
        "403": { $ref: "#/components/responses/Error" }
        "404": { $ref: "#/components/responses/Error" }
  /orgs/{orgId}/sub-orgs:
    get:
      operationId: listSubOrgs
      summary: List this org's sub-orgs, oldest first, at most 500 (scope orgs:read).
      parameters:
        - $ref: "#/components/parameters/orgId"
      responses:
        "200":
          description: Sub-orgs.
          content:
            application/json:
              schema:
                type: object
                properties:
                  sub_orgs:
                    type: array
                    items: { $ref: "#/components/schemas/SubOrg" }
        "403": { $ref: "#/components/responses/Error" }
        "404": { $ref: "#/components/responses/Error" }
    post:
      operationId: createSubOrg
      summary: Create a sub-org, idempotent on (parent, client_ref) (scope orgs:write).
      parameters:
        - $ref: "#/components/parameters/orgId"
      requestBody:
        required: true
        content:
          application/json:
            schema: { $ref: "#/components/schemas/SubOrgCreate" }
      responses:
        "201":
          description: Created.
          content:
            application/json:
              schema: { $ref: "#/components/schemas/SubOrgResponse" }
        "200":
          description: Replay of the same client_ref with the same body. Same sub-org.
          content:
            application/json:
              schema: { $ref: "#/components/schemas/SubOrgResponse" }
        "400": { $ref: "#/components/responses/Error" }
        "403":
          description: Missing scope, or hide_branding=true without entitlement (code not_entitled).
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ErrorBody" }
        "404": { $ref: "#/components/responses/Error" }
        "409":
          description: client_ref_conflict (same client_ref, different body), slug_taken, or sub_org_depth (the caller is itself a sub-org).
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ErrorBody" }
        "429": { $ref: "#/components/responses/Error" }
  /orgs/{orgId}/sub-orgs/{subId}:
    parameters:
      - $ref: "#/components/parameters/orgId"
      - name: subId
        in: path
        required: true
        schema: { type: string, format: uuid }
    get:
      operationId: getSubOrg
      summary: Read one sub-org (scope orgs:read). Another parent's sub-org is 404, never 403.
      responses:
        "200":
          description: The sub-org.
          content:
            application/json:
              schema: { $ref: "#/components/schemas/SubOrgResponse" }
        "403": { $ref: "#/components/responses/Error" }
        "404": { $ref: "#/components/responses/Error" }
    patch:
      operationId: patchSubOrg
      summary: Change hide_branding and/or billing_attribution (scope orgs:write).
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              minProperties: 1
              properties:
                hide_branding: { type: boolean }
                billing_attribution: { type: string, enum: [self, parent] }
      responses:
        "200":
          description: Updated.
          content:
            application/json:
              schema: { $ref: "#/components/schemas/SubOrgResponse" }
        "400": { $ref: "#/components/responses/Error" }
        "403":
          description: Missing scope, or hide_branding=true not entitled (not_entitled).
          content:
            application/json:
              schema: { $ref: "#/components/schemas/ErrorBody" }
        "404": { $ref: "#/components/responses/Error" }
components:
  securitySchemes:
    platformKey:
      type: http
      scheme: bearer
      description: TW_PLATFORM_MASTER_KEY. Only POST /orgs.
    orgKey:
      type: http
      scheme: bearer
      description: "twk_<8 hex>.<48 hex>. Scopes orgs:read orgs:write members:write event-types:write bookings:read webhooks:write. 120 requests/minute per key."
  parameters:
    orgId:
      name: orgId
      in: path
      required: true
      description: Must be the key's own org, otherwise 404.
      schema: { type: string, format: uuid }
  responses:
    Error:
      description: Error. Codes include invalid_request, unauthorized, forbidden, not_found, method_not_allowed, slug_taken, owner_email_in_use, email_in_use, plan_limit_members, plan_limit_event_types, rate_limited, internal.
      content:
        application/json:
          schema: { $ref: "#/components/schemas/ErrorBody" }
  schemas:
    ErrorBody:
      type: object
      required: [error]
      properties:
        error:
          type: object
          required: [code, message]
          properties:
            code: { type: string }
            message: { type: string }
    ProvisionRequest:
      type: object
      required: [external_ref, name, owner]
      properties:
        external_ref: { type: string, maxLength: 128 }
        name: { type: string, maxLength: 120 }
        slug: { type: string, maxLength: 50 }
        plan_code: { type: string, maxLength: 40 }
        owner:
          type: object
          required: [email]
          properties:
            email: { type: string, format: email }
            name: { type: string }
            username: { type: string }
            timezone: { type: string }
        working_hours:
          type: object
          required: [days, start, end]
          properties:
            days: { type: array, items: { type: integer, minimum: 0, maximum: 6 } }
            start: { type: string, pattern: "^[0-2][0-9]:[0-5][0-9]$" }
            end: { type: string, pattern: "^[0-2][0-9]:[0-5][0-9]$" }
    ProvisionResponse:
      type: object
      required: [org]
      properties:
        org: { type: object, additionalProperties: true }
        api_key:
          type: object
          description: Present on 201 only; raw is shown once.
          properties:
            id: { type: string }
            prefix: { type: string }
            raw: { type: string }
            scopes: { type: array, items: { type: string } }
    Member:
      type: object
      properties:
        role: { type: string }
        managed: { type: boolean }
        user: { type: object, additionalProperties: true }
    SubOrgCreate:
      type: object
      required: [client_ref, name]
      properties:
        client_ref: { type: string, maxLength: 100 }
        name: { type: string, maxLength: 120 }
        slug: { type: string, maxLength: 50 }
        billing_attribution: { type: string, enum: [self, parent], default: self }
        hide_branding: { type: boolean, default: false }
    SubOrg:
      type: object
      properties:
        id: { type: string, format: uuid }
        slug: { type: string }
        name: { type: string }
        client_ref: { type: [string, "null"] }
        parent_org_id: { type: string, format: uuid }
        status: { type: string }
        hide_branding: { type: boolean }
        billing_attribution: { type: string, enum: [self, parent] }
        is_sandbox: { type: boolean }
        created_at: { type: string, format: date-time }
    SubOrgResponse:
      type: object
      properties:
        sub_org: { $ref: "#/components/schemas/SubOrg" }
```

### Sub-org contract (E1, E3, E4)

- One level only. A sub-org cannot have sub-orgs (409 `sub_org_depth`). A sub-org is a Timeway org row with `parentOrgId`; it has no key of its own.
- Idempotent on `(parent, client_ref)`. Replay with the same body: `200`, same sub-org. Same `client_ref` with a different `name`, `billing_attribution`, `hide_branding` or (when given) `slug`: `409 client_ref_conflict`. Concurrent creates: one `201`, the other `200`.
- The stored reference is `sub:<parentOrgId>:<client_ref>`; the API only ever shows `client_ref`.
- `hide_branding` can be turned on only when the sub-org's or its parent's plan is on the allowlist (`TW_UNBRANDED_PLAN_CODES`; unset means nobody): otherwise `403 not_entitled`. Turning it off is always allowed.
- Reads and writes are limited to the caller's own sub-orgs; another parent's id is `404`.

### Sandbox orgs (E7)

A sandbox org is unbilled, and so is every sub-org of a sandbox parent (`is_sandbox` is inherited at create, never chosen by the caller). Sandbox orgs emit no usage lines. Code state at this commit: `is_sandbox` is inherited and read-only through the API. The planned limits (no live payment apps, at most 25 managed users) are not enforced by the org API yet; do not rely on them.

### Billing attribution (E5)

`billing_attribution=self` invoices the sub-org itself; `parent` invoices the parent org. Usage lines name the invoiced org and carry the originating sub-org as `clientOrgId` for itemising.

### Metered units (E6)

Two raw-count meters are reported to Passport. No prices appear here or anywhere in Timeway; see the public pricing page at https://timeway.co/pricing (prices live in Passport).

- `timeway_api_managed_user`: one daily snapshot per billing org, the last value in the period; managed members summed over the billing org and every client org that bills to it.
- `timeway_api_booking`: 1 per booking created through the API for a managed member; a cancellation does not reverse it.
