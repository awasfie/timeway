# INT-2 — SalesOS <-> Timeway (booking), Timeway sender side

Contract (Bible INT-2): `BookingProvider` -> `TimewayProvider` (slots/book/reschedule/cancel); webhooks `booking.created` / `rescheduled` / `cancelled` / `no_show` -> salesos-api -> lifecycle transitions (Part C). Org mapping via Passport `ProductInstanceLink`. The hub doc (receiver side, all INT-n) is `awasfie/salesos` `docs/integrations/INT-2.md`.

## Sender code

Every outbound webhook delivery builds its signature headers in one place, `packages/features/webhooks/lib/webhookSignature.ts` (`createWebhookHeaders`). It is used by:

- `packages/features/webhooks/lib/sendPayload.ts` (`_sendPayload`; booking triggers and the tasker `sendWebhook` task)
- `packages/features/webhooks/lib/handleWebhookScheduledTriggers.ts` (scheduled triggers such as `MEETING_ENDED`, no-show)
- `packages/features/webhooks/lib/service/WebhookService.ts` (`sendWebhookDirectly`)

## Headers

| Subscription secret | Headers sent |
|---|---|
| none | `X-Cal-Signature-256: no-secret-provided` (unchanged) |
| any value not starting with `whsec_` | `X-Cal-Signature-256` only: hex HMAC-SHA256 of the raw body with the secret string (unchanged; third-party Cal.com-style subscribers see no difference) |
| `whsec_...` | `X-Cal-Signature-256` (same HMAC over the same secret string) **and** Standard Webhooks `webhook-id`, `webhook-timestamp`, `webhook-signature` |

Standard Webhooks details (from `@family/webhooks` `signHeaders`): `webhook-id` = `msg_<random>`, `webhook-timestamp` = unix seconds, `webhook-signature` = `v1,<base64 HMAC-SHA256>` over `${id}.${timestamp}.${rawBody}` with the base64-decoded key after `whsec_` (24-64 bytes). The signed content is the exact body bytes sent. A malformed `whsec_` secret logs a warning and the delivery still goes out with the legacy header only, so no delivery is dropped.

## Package

`@family/webhooks` 0.1.0, vendored as `packages/features/vendor/family-webhooks-0.1.0.tgz`, built from `awasfie/passport` `e271205` with `cd packages/webhooks && npx tsc -p tsconfig.json && npm pack`. sha256 `2341ef7310f793f9d4ca2a202143edd5364ddb21e814c84a9d2d8c9952191544` (byte-identical to the salesos copy). ESM-only: in Timeway it is consumed by Next.js / Vite bundling and Vitest, not by a CommonJS `require`, so the Node 20 image is unaffected. No source is copied into this repo.

Docker build (card FIX-timeway-tgz-prune): the root `Dockerfile` no longer runs `npx turbo@2.7.1 prune --scope=@calcom/web --scope=@calcom/trpc --docker`. turbo's berry lockfile parser (2.7.1 and 2.11.9 alike) fails on the `@family/webhooks@file:vendor/...tgz::locator=...` entry with "Unable to find any locator", which failed Coolify deployment `xvgfkree5wdxalvnbg46svxh`. A root `resolutions` entry and a `file:./` spec fail the same way. The step was dead weight: its `out/` tree was never copied, so the image is built from the full workspace as before and its contents are unchanged. The tarball bytes and the dependency spec stay as above. The `docker-migrate-job` workflow builds the image on every PR that touches the `Dockerfile`.

## Payload (Cal.com shape)

```json
{ "triggerEvent": "BOOKING_CREATED", "createdAt": "<ISO>", "payload": { "uid": "<bookingUid>", "startTime": "<ISO>", "endTime": "<ISO>", "organizer": {}, "attendees": [], "metadata": { "videoCallUrl": "https://camv.co/room/tw-<uid>" } } }
```

Events used by INT-2: `BOOKING_CREATED`, `BOOKING_RESCHEDULED`, `BOOKING_CANCELLED`, `BOOKING_NO_SHOW_UPDATED` -> `booking.created|rescheduled|cancelled|no_show`.

## Secrets (names only)

- Sender: the secret lives on the Timeway webhook subscription row (`Webhook.secret`) for the salesos subscriber, set through the Timeway webhook settings UI/API. It is not an env variable.
- Receiver (salesos-api, Infisical `spenai` -> Coolify env): `TIMEWAY_WEBHOOK_SECRET`, `TIMEWAY_WEBHOOK_SECRET_PREVIOUS`, switch `TIMEWAY_WEBHOOK_LEGACY`.

## Rotation (no dropped delivery)

1. Generate a secret with `generateSecret()` from `@family/webhooks` (32 bytes, `whsec_` prefix). Store it in Infisical `spenai` as `TIMEWAY_WEBHOOK_SECRET` (old value to `TIMEWAY_WEBHOOK_SECRET_PREVIOUS`) and sync to Coolify.
2. Redeploy the receiver first. It verifies Standard headers against `[current, previous]` and still accepts the legacy header.
3. Set the same value as the salesos subscription secret in Timeway. From the next delivery Timeway sends both the Standard headers and `X-Cal-Signature-256`.
4. Watch the receiver log for legacy-path acceptances to reach zero, then set `TIMEWAY_WEBHOOK_LEGACY=off` and redeploy the receiver (card WC-PE-14g5).
5. After one full sender retry horizon, remove `TIMEWAY_WEBHOOK_SECRET_PREVIOUS`.

## Tests (CC-32 sender half)

- `packages/features/webhooks/lib/webhookSignature.test.ts`: non-`whsec_` gives only `X-Cal-Signature-256`; `whsec_` output verifies with the reference `standardwebhooks` `Webhook.verify`; altered body or wrong secret is rejected; malformed `whsec_` keeps the legacy header.
- `sendPayload.test.ts`, `handleWebhookScheduledTriggers.test.ts`, `service/WebhookService.test.ts`: per sender path, a `whsec_` subscriber's delivery verifies with `Webhook.verify` and a non-`whsec_` subscriber gets no `webhook-*` headers.
- The live CC-32 recording (verify + replay at +6 min rejected) is card WC-PE-14g5, against merged main.
