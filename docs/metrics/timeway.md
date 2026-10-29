# Timeway product metrics (WC-TW-9 proof, WC.2.5)

Card t_75e3ae48 (WC-TW-9e), closes the WC-TW-9 proof (t_a5bf8b29). Bible WC-9, WC-TW-9 line and WC.2.5 table.

Dashboard (decision 2: no new dashboard tool):

- Plausible CE, site `timeway.co` (site_id 1, tz Asia/Dubai) at `https://stats.timeway.co`.
  Shared link `https://stats.timeway.co/share/timeway.co`; the full URL with its `auth` token is in Infisical
  `timeway:/plausible` `PLAUSIBLE_SHARED_LINK_URL` and the password in `PLAUSIBLE_SHARED_LINK_PASSWORD`.
  Goals: `booking_page_view` -> `slot_selected` -> `booking_confirmed` (goal ratio; the server event cannot join a browser-visitor funnel, see Status).
- `scripts/activation.ts` output (timeway) and `api/scripts/messaging-metrics.js` output (whatsaff), pasted below with date.

## Status on 2026-10-29

The pipeline is live and every metric owned by WC-TW-9 now has a first production value. timeway#89 and #101 merged
(58b31b6fdc, 65f2630df5), deployed by t_ff5073b0. When this doc was measured (2026-10-29T06:22Z) the web app ran image `:65f2630df5` with `PLAUSIBLE_HOST` and
`PLAUSIBLE_DOMAIN` set.

Proof booking (decision 3; named on the card before it was made). Booked through the public booker UI at
`https://timeway.co/ahmedwasfie/30min` on staff account `ahmedwasfie` (org `spenai-pilot`
`27eb38bb-0de9-447a-809b-7edd21bbfc78`). Attendee "Simon WC-TW-9e proof" <info@awstreams.com>, slot Fri 2026-11-06
09:00 Asia/Dubai, booking uid `hbR5zcRghBzyvpGSYoxXxY` (id 442), created 2026-10-29T06:20:26Z. It was cancelled through
the booker's cancel page right after the counts were taken (status `cancelled`). The browser was headless Chromium
(Playwright), tz Asia/Dubai.

What the run showed:

- Client `booking_page_view` (props org, event_type, source=direct) and `slot_selected` reach Plausible through the
  first-party `/api/pa/event` (202).
- Server `booking_confirmed` and `first_external_booking` (source=WEBAPP) reach Plausible at the second the booking was
  created. `tw_activation_event` got its first row, `first_external_booking` for `spenai-pilot`.
- Each page load sends `pageview` and `booking_page_view` **twice**: 2 loads produced 4 of each. Visitor counts are
  unaffected, but event counts are inflated. Follow-up card: see the PR body.
- Server events carry a different Plausible visitor hash, because the server IP and UA differ from the browser's. A
  Plausible funnel step cannot join `booking_confirmed` to the browser visitor. Conversion is therefore the ratio of the
  goals' unique visitors over the same window (Friday block), not a funnel join.

## Metrics

| metric (WC.2.5) | definition | source | command / link | target | first measured value (date) |
| --- | --- | --- | --- | --- | --- |
| View -> booked conversion | unique visitors of goal `booking_confirmed` / unique visitors of goal `booking_page_view`, 7 days, per org (`org` prop); goal ratio, not funnel join (see Status) | Plausible: client `booking_page_view`, `slot_selected` (9c); server `booking_confirmed` (9b) | shared link above (Goals, filter by `org`); ClickHouse query in the Friday block | WC.2.5 row | 1 / 1 = 100% on 2026-10-29 (n=1, the proof booking only; not a real-traffic rate). Event counts: page_view 4, slot_selected 1, booking_confirmed 1 |
| Activation <= 7 days | orgs with `calendar_connected`, `event_type_published` and `first_external_booking` all within 7 days of `tw_organization.createdAt` / non-sandbox orgs, by signup-week cohort | `tw_activation_event` (9b, migration `20261021120000_wc_tw_9b_activation_event`) | `node_modules/.bin/ts-node --transpile-only scripts/activation.ts --since 2026-10-23` in the timeway web container | >= 40% | 0 orgs in cohorts since 2026-10-23, pct `-` (2026-10-29T06:22Z). `tw_activation_event` has 1 row (`first_external_booking`, spenai-pilot, an org created 2026-10-07, outside the cohort window) |
| WhatsApp delivered / read | delivered % = delivered / sent; read % = read / delivered, 7 days, by country SA/AE/EG | whatsaff `meta_message_ledger` from WhatsApp status webhooks (9d, whatsaff.ai#65 + #118) | `node scripts/messaging-metrics.js --days 7` in the whatsaff-api container (`/app`) | WC.2.5 row | all sources: 2 sent, delivered 100%, read 0%, 0 failed (AE) (2026-10-29T06:22Z). Timeway source: 0 sent |
| Messaging cost per booking | sum `est_cost_usd` / distinct `callback_ref` bookings, source `timeway` | same ledger, rate card `meta-2026-10-01` | `node scripts/messaging-metrics.js --days 7 --source timeway` | WC.2.5 row | `-`: 0 timeway messages and 0 bookings (2026-10-29T06:22Z). Timeway does not send WhatsApp until WC-TW-10 (t_e531c02a) |
| Invite bounce / complaint | (bounce + dropped) / processed; spamreport / delivered, 7 days | SendGrid Event Webhook ledger | pending t_593fe699 (WC-TW-8c, `scripts/email-deliverability.ts`) | < 1% / < 0.1% | pending t_593fe699 |

## Friday line

Run every Friday and paste the output with its UTC date into the Friday line.

```sh
# Activation (timeway web container on 62.171.141.202)
C=$(docker ps --format '{{.Names}}' | grep poyzdsncp9jsvc3gr4hkitaf | head -1)
docker exec "$C" sh -c 'cd /calcom && node_modules/.bin/ts-node --transpile-only scripts/activation.ts --since 2026-10-23'

# WhatsApp delivered/read and cost per booking (whatsaff-api container on 62.171.141.202)
A=$(docker ps --format '{{.Names}}' | grep '^g28uufxyx5qoaxlwxuelixle' | head -1)
docker exec "$A" sh -c 'cd /app && node scripts/messaging-metrics.js --days 7 && node scripts/messaging-metrics.js --days 7 --source timeway'

# View -> booked (Plausible ClickHouse on 84.247.170.1; same numbers as the shared link's Goals panel)
docker exec plausible-events-db-vxhmw2yydnnjnzbzs39whdf5 clickhouse-client -q "select name, count() events, uniq(user_id) visitors
  from plausible_events_db.events_v2 where site_id=1 and timestamp >= now() - interval 7 day
  and name in ('booking_page_view','slot_selected','booking_confirmed') group by name order by name"
```

## Raw outputs (2026-10-29, run on card t_75e3ae48)

```text
$ ts-node --transpile-only scripts/activation.ts --since 2026-10-23   # image poyzdsncp9jsvc3gr4hkitaf:65f2630df5, 2026-10-29T06:22:34Z
activation <= 7 days (target >= 40%), cohorts since 2026-10-23
week_of     orgs  activated  pct
total          0          0  -

$ node scripts/messaging-metrics.js --days 7          # image g28uufxyx5qoaxlwxuelixle:d254f7b8bb, 2026-10-29T06:22Z
meta_message_ledger since 2026-10-22T06:22:36.652Z (7 d)
country  sent  delivered%  read%  failed  cost/msg USD  bookings  cost/booking USD
ALL         2        100      0       0             0         0                 -
SA          0          -      -       0             -         0                 -
AE          2        100      0       0             0         0                 -
EG          0          -      -       0             -         0                 -

$ node scripts/messaging-metrics.js --days 7 --source timeway
meta_message_ledger since 2026-10-22T06:22:36.980Z (7 d) source=timeway
country  sent  delivered%  read%  failed  cost/msg USD  bookings  cost/booking USD
ALL         0          -      -       0             -         0                 -
SA          0          -      -       0             -         0                 -
AE          0          -      -       0             -         0                 -
EG          0          -      -       0             -         0                 -

$ clickhouse-client: events_v2 site_id=1 since 2026-10-29 00:00 UTC, by name   # 2026-10-29T06:22Z
name                    events  visitors
booking_confirmed            1         1
booking_page_view            4         1
engagement                   2         1
first_external_booking       1         1
pageview                     4         1
slot_selected                1         1

$ clickhouse-client: events_v2 rows of the proof booking
2026-10-29 06:20:26  booking_confirmed       org=27eb38bb-0de9-447a-809b-7edd21bbfc78 event_type=2 source=WEBAPP
2026-10-29 06:20:26  first_external_booking  org=27eb38bb-0de9-447a-809b-7edd21bbfc78 event_type=2 source=WEBAPP

$ read-only query (withTwPlatform) in the timeway web container
Booking uid=hbR5zcRghBzyvpGSYoxXxY id=442 status=cancelled eventTypeId=2 createdAt=2026-10-29T06:20:26.056Z
tw_activation_event kind=first_external_booking twOrgId=27eb38bb-... refId=hbR5zcRghBzyvpGSYoxXxY occurredAt=2026-10-29T06:20:26.107Z
```

The two real ledger docs are Gosi's live sends to Ahmed's own number: `6ae13ff89c9aec61eaf3a43d` (t_22fb5a16) and
`6ae241689c9aec61eaf3a43f` (t_437995b6): AE, service, not billable, USD 0, rate card `meta-2026-10-01`.
