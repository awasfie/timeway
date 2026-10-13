# Timeway calendar sync dashboard (WC-TW-3 step 3)

`timeway-calendar-sync.json` is a Grafana dashboard over a Prometheus datasource
(Grafana Cloud Mimir once WC-PE-4 step 3 provisions it). Import it, pick the datasource.

Scrape target: `GET https://timeway.co/api/metrics/calendar-sync` with
`Authorization: Bearer $TIMEWAY_METRICS_TOKEN`. Without that env the route answers 404.

| Panel | Series |
|---|---|
| Lag p50 / p95 per provider | `timeway_sync_lag_seconds` histogram (incremental syncs only) |
| 410 count | `timeway_sync_token_invalidated_total` |
| Expiries | `timeway_calendar_channels_expiring{window="expired"\|"1h"}` (read from the DB at scrape) |
| Reconciliation diffs | `timeway_reconciliation_diff_total{kind="added"\|"removed"\|"changed"}` |
| Stale calendars | `timeway_stale_calendars` (syncedAt older than 15 min, read from the DB at scrape) |

The histogram and counters are per process; use `rate()`/`increase()`, which absorb restarts.
The same events also go to Sentry metrics (`calendar.subscription.*`, `calendar.reconciliation.*`).
