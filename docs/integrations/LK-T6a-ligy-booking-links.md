# LK-T6a — Booking links through Ligy

Bible: LK-12 (LK-T6), Q-7 (Q.LIGY). Card t_74c10135.

## What
Booking confirmation, reschedule and cancel links in Timeway's booking emails (`ManageLink`) and booking SMS
(scheduled / rescheduled) are composed through Ligy `POST /internal/service-links` with `sourceRef: booking:<uid>`.
Each recipient gets their own cancel / reschedule link (they carry `cancelledBy` / `rescheduledBy`), all with the same
`sourceRef`, so Ligy's `link.clicked` maps every click back to the booking.

## Where
- `packages/lib/ligy/serviceLinks.ts`: one call, 300 ms timeout (abort), long-URL fallback on every failure (CC-43).
- `packages/lib/ligy/attachLigyLinks.ts`: composes per recipient (attendees, organizer, team; cap 20) in parallel and
  sets `calEvent.ligyLinks` (keyed by lower-cased email). Called at the top of the scheduled / rescheduled / seat
  senders in `packages/emails/email-manager.ts`. Platform (API-client) bookings are untouched.
- `ManageLink.tsx`, `event-scheduled-sms.ts`, `event-rescheduled-sms.ts`: use the override when present, the long URL
  otherwise. A link hidden on the long path (disableCancelling / disableRescheduling) stays hidden.

## Config (Coolify env, by name)
| Name | Default | Notes |
| --- | --- | --- |
| `TIMEWAY_LIGY_LINKS_ENABLED` | off | only the literal `true` turns it on |
| `LIGY_SERVICE_KEY` | - | Ligy product key `lks_timeway_...`, scope `service-links:write`, bound to Timeway's workspace |
| `LIGY_INTERNAL_URL` | `https://app.li.gy` | Ligy app base |

## Contract
Ligy docs/api/link.md (`POST /internal/service-links`). Request
`{"longUrl","sourceRef":"booking:<uid>","tags":["timeway","booking|cancel|reschedule"]}`, `Authorization: Bearer <key>`;
`201` / `200` (replay) -> `{"id","shortUrl","sourceRef"}`. The endpoint is in awasfie/link draft PR #25 (stacked on
#24, not merged at time of writing); this code follows that branch's documented contract. Ligy's `sourceRefAllowed`
constrains only Spenai today, so `booking:<uid>` passes as-is.

## Worst case
Flag on, Ligy down or slow: each send waits at most ~300 ms once (calls run in parallel), then sends the long URLs.
No booking email or SMS fails because of Ligy.
