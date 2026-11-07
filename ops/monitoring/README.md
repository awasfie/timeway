# Timeway monitoring (R1-TW-MONITORING, t_1ee20514)

R1 item from R-61: an uptime check plus a burn-rate alert that reaches Ahmed's phone path. The shape follows Bible WC-30 (WC-PE-4 step 4): a multi-window burn rate, where 5x over 1 h pages and 1x over 6 h opens a ticket.

## What runs, and where

- **Uptime, external.** Better Stack monitor 5059546 `timeway-health` checks GET `timeway.co/api/version` every 3 min from 4 regions and alerts by email and push. Its status shows on https://status.spenai.net. It was created by WC-PE-4 (awasfie/salesos `ops/observability/betterstack.py`).
- **SLI probes.** Container `g3-blackbox-timeway` on 62.171.141.202 (`docker-compose.yml` here, compose project `tw-monitoring`, files in `/opt/g3-observability/timeway`). It probes through the public path (Cloudflare, then the Coolify proxy) every 30 s:
  - `tw_version`: `https://timeway.co/api/version` must return 200 with a body containing `"version"`.
  - `tw_login`: `https://timeway.co/auth/login` must return 200 and render `data-testid="login-form"` (R-73: a 200 alone is not proof).
- **Burn-rate rules.** `timeway-slo.rules.yml` is copied to `/opt/g3-observability/rules/` and loaded by `g3-prometheus`. The SLO is 99.5 % availability, so the error budget is 0.005.
  - `TimewayBurnRatePage` (severity=page) fires when the 1 h error ratio exceeds 2.5 % and so does the 5 m ratio, for 2 min.
  - `TimewayBurnRateTicket` (severity=ticket) fires when the 6 h ratio exceeds 0.5 % and so does the 30 m ratio, for 15 min.
  - `TimewayProbeMissing` (severity=page) fires when there is no probe data for 10 min, so the monitoring cannot go blind without anyone knowing.
- **Delivery (the phone path).** The alerts go through `g3-alerts-poller.js` `promRuleAlerts()` (awasfie/salesos `ops/g3-observability`, host cron every 5 min). It forwards every firing alert labelled `severity=page|ticket` once, and sends RESOLVED when it clears, to the n8n workflow "G3 - Generic Alert -> Telegram". That workflow posts to the Spenai Alerts Telegram group on Ahmed's phone. The voice-call leg (Grafana IRM / Better Stack on-call) is WC-PE-4 steps 4-6, card t_ba13cdc3. It is gated on R-55 (paid) and on Ahmed's phone verification, and it is not part of R1.

## Tests

`promtool test rules timeway-slo.rules.test.yml` (Prometheus 3.5.5) covers four cases:

- healthy: no alert;
- a 6-min full outage: the page fires during the outage and clears 5 min after recovery;
- a 1 % error rate for 7 h: a ticket, no page;
- the exporter gone: ProbeMissing.

## Apply / drill / rollback (root on 62.171.141.202, from `/opt/g3-observability/timeway`)

    ./apply.sh apply        # backs up prometheus.yml (.bak-<ts>), starts blackbox, appends scrape job, installs rules, promtool check config, SIGHUP; rolls back on a failed check
    ./apply.sh drill-on     # adds target product=timeway-drill with the tw_drill_fail module (real request, impossible body match): the same rules fire for timeway-drill
    ./apply.sh drill-off    # removes the drill target; alert resolves
    ./apply.sh rollback <ts>

The drill never touches Timeway itself: no deploy, no stop, no traffic change.
