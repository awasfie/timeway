# Timeway product metrics (WC-TW-9 proof, WC.2.5)

Card t_75e3ae48 (WC-TW-9e), closes the WC-TW-9 proof (t_a5bf8b29). Bible WC-9, WC-TW-9 line and WC.2.5 table.

Dashboard (decision 2: no new dashboard tool):

- Plausible CE, site `timeway.co` (site_id 1, tz Asia/Dubai) at `https://stats.timeway.co`.
  Shared link (password in Infisical `timeway:/plausible` `PLAUSIBLE_SHARED_LINK_PASSWORD`):
  `https://stats.timeway.co/share/timeway.co?auth=OON_EFpk_GlYs8CgP3SpP`.
  Funnel: `booking_page_view` -> `slot_selected` -> `booking_confirmed`.
- `scripts/activation.ts` output (timeway) and `api/scripts/messaging-metrics.js` output (whatsaff), pasted below with date.

## Status on 2026-10-28

The proof is **not met yet**. The two activation and messaging scripts run in production and their values are below.
The Plausible funnel has no real data, because the client events and the server env are not deployed:

- timeway#89 (WC-TW-9a, `/js/pa.js` + `/api/pa/event` rewrites) and timeway#101 (WC-TW-9c, `booking_page_view` +
  `slot_selected`) are still open drafts. `https://timeway.co/js/pa.js` returns 404 on the deployed app.
- The timeway web app (Coolify `poyzdsncp9jsvc3gr4hkitaf`, image `:0f595a2322`) has no `PLAUSIBLE_HOST` or
  `PLAUSIBLE_DOMAIN` env, so the server `booking_confirmed` event from WC-TW-9b (`packages/lib/trackServerEvent.ts`)
  is a no-op.
- Plausible ClickHouse `events_v2` for site 1 holds one row: the t_d76f81bd ingest probe (2026-10-21 01:48:06).

The first real funnel value is taken after those land, from a real booking on a real staff account named on the card first.

## Metrics

| metric (WC.2.5) | definition | source | command / link | target | first measured value (date) |
| --- | --- | --- | --- | --- | --- |
| View -> booked conversion | unique visitors with `booking_confirmed` / unique visitors with `booking_page_view`, 7 days, per org (`org` prop) | Plausible: client `booking_page_view`, `slot_selected` (9c); server `booking_confirmed` (9b) | shared link above, Funnels; or the Stats API query in the Friday block | WC.2.5 row | no data (2026-10-28): 0 real events; pipeline not deployed (see Status) |
| Activation <= 7 days | orgs with `calendar_connected`, `event_type_published` and `first_external_booking` all within 7 days of `tw_organization.createdAt` / non-sandbox orgs, by signup-week cohort | `tw_activation_event` (9b, migration `20261021120000_wc_tw_9b_activation_event`) | `node_modules/.bin/ts-node --transpile-only scripts/activation.ts --since 2026-10-23` in the timeway web container | >= 40% | 0 orgs in cohorts since 2026-10-23, pct `-` (2026-10-28T19:11Z); `tw_activation_event` has 0 rows |
| WhatsApp delivered / read | delivered % = delivered / sent; read % = read / delivered, 7 days, by country SA/AE/EG | whatsaff `meta_message_ledger` from WhatsApp status webhooks (9d, whatsaff.ai#65 + #118) | `node scripts/messaging-metrics.js --days 7` in the whatsaff-api container (`/app`) | WC.2.5 row | all sources: 2 sent, delivered 100%, read 0%, 0 failed (AE) (2026-10-28T19:11Z). Timeway source: 0 sent |
| Messaging cost per booking | sum `est_cost_usd` / distinct `callback_ref` bookings, source `timeway` | same ledger, rate card `meta-2026-10-01` | `node scripts/messaging-metrics.js --days 7 --source timeway` | WC.2.5 row | `-`: 0 timeway messages and 0 bookings (2026-10-28T19:11Z). Timeway does not send WhatsApp until WC-TW-10 (t_e531c02a) |
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

# View -> booked funnel (Plausible Stats API v2; key in Infisical timeway:/plausible once created)
curl -s https://stats.timeway.co/api/v2/query -H "Authorization: Bearer $PLAUSIBLE_STATS_KEY" \
  -H 'content-type: application/json' \
  -d '{"site_id":"timeway.co","metrics":["visitors","events"],"date_range":"7d","dimensions":["event:goal"],"filters":[["is","event:goal",["booking_page_view","slot_selected","booking_confirmed"]]]}'
```

## Raw outputs (2026-10-28)

```text
$ node scripts/messaging-metrics.js --days 7          # whatsaff-api image 824e796d, 2026-10-28T19:11:02Z
meta_message_ledger since 2026-10-21T19:11:03.504Z (7 d)
country  sent  delivered%  read%  failed  cost/msg USD  bookings  cost/booking USD
ALL         2        100      0       0             0         0                 -
SA          0          -      -       0             -         0                 -
AE          2        100      0       0             0         0                 -
EG          0          -      -       0             -         0                 -

$ node scripts/messaging-metrics.js --days 7 --source timeway
meta_message_ledger since 2026-10-21T19:11:03.950Z (7 d) source=timeway
country  sent  delivered%  read%  failed  cost/msg USD  bookings  cost/booking USD
ALL         0          -      -       0             -         0                 -
SA          0          -      -       0             -         0                 -
AE          0          -      -       0             -         0                 -
EG          0          -      -       0             -         0                 -

$ ts-node --transpile-only scripts/activation.ts --since 2026-10-23   # timeway image 0f595a2322, 2026-10-28T19:11:26Z
activation <= 7 days (target >= 40%), cohorts since 2026-10-23
week_of     orgs  activated  pct
total          0          0  -

$ clickhouse-client: events_v2 site_id=1 by name      # plausible-events-db, 2026-10-28T19:11:42Z
booking_page_view  1  2026-10-21 01:48:06  2026-10-21 01:48:06   (t_d76f81bd probe, not real traffic)
```

The two real ledger docs are Gosi's live sends to Ahmed's own number: `6ae13ff89c9aec61eaf3a43d` (t_22fb5a16) and
`6ae241689c9aec61eaf3a43f` (t_437995b6): AE, service, not billable, USD 0, rate card `meta-2026-10-01`.
