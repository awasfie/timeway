# Timeway booking page performance (CC-56 evidence, WC-TW-6d)

Card t_762bea7b (WC-TW-6 proof). Bible WC-9, WC-TW-6 line; WC.2.5 rows LCP p75, TTFB p75, slot API p95.

Target: the deployed production booking page `https://timeway.co/ahmedwasfie/30min` (a real public event type).

Deploy measured: `d43cce3ddadc1d71475d2c3557fd5bc610ecf872` (main, timeway#108), Coolify app `timeway-web`
deployment `e046vk7mp3ozc4ldtrxnlrvr`, finished 2026-10-27 23:47:57Z. That was the newest deployment when
these numbers were taken (2026-10-28 01:10 to 01:25Z).

## Verdict

The gate is **not met**. 2 of 9 rows pass (TTFB from Cairo and from Riyadh). Fix cards hold the measured numbers;
this card stays open until every row passes on a later deploy.

| region | metric | gate | p75 / value | samples | run id / artifact | deploy SHA | result |
| --- | --- | --- | ---: | ---: | --- | --- | --- |
| cairo | TTFB (HTTPS, after TLS) | p75 < 500 ms | 379 ms (p50 356) | 27 | Globalping, 9 x 3 probes; `evidence/2026-10-28-region-ttfb-globalping.json` | d43cce3dda | PASS |
| riyadh | TTFB (HTTPS, after TLS) | p75 < 500 ms | 404.5 ms (p50 363) | 27 | same | d43cce3dda | PASS |
| dubai | TTFB (HTTPS, after TLS) | p75 < 500 ms | 617.5 ms (p50 382) | 27 | same | d43cce3dda | FAIL |
| dubai (prod, real network) | LCP, Lighthouse mobile slow 4G | p75 < 2500 ms (target 1500) | 7076 ms median, 7224 max | 5 | local Lighthouse 13.5.0 from a Dubai host (AS15802); `evidence/2026-10-28-wc-tw-6d.json` | d43cce3dda | FAIL |
| cairo (CI build, RTT-tagged) | LCP | p75 < 2500 ms | 8537 ms median | 5 | booking-perf run 40600454883, artifact `booking-perf-gh-runner` | d43cce3dda | FAIL |
| riyadh (CI build, RTT-tagged) | LCP | p75 < 2500 ms | 8728 ms median | 5 | same | d43cce3dda | FAIL |
| dubai (CI build, RTT-tagged) | LCP | p75 < 2500 ms | 8741 ms median | 5 | same | d43cce3dda | FAIL |
| all | INP (lab TBT proxy) | < 200 ms | prod 392 ms median; CI cairo 626, riyadh 696, dubai 589 | 5 per source | same as LCP rows | d43cce3dda | FAIL |
| all | INP (RUM, Plausible) | < 200 ms | no data: Plausible is not on the deployed page | 0 | page HTML has no Plausible script; timeway#89 and #101 are open drafts | d43cce3dda | MISSING |
| gh-runner | booking-route first-load JS | <= 200 KB gz | 857.5 KB gz in 49 scripts (prod transfer 837 KB) | 1 build | booking-perf run 40600454883, `js-budget-gh-runner.json` | d43cce3dda | FAIL |
| dubai | slot API `slots/getSchedule` (the booker's own call, 2-month range) | p95 < 800 ms | 811 ms (p50 740, max 837) | 30 | curl from the Dubai host; `evidence/2026-10-28-wc-tw-6d.json` | d43cce3dda | FAIL |
| any org | per-tenant RUM in Plausible | visible for >= 1 org | not visible: not deployed | 0 | see INP RUM row | d43cce3dda | MISSING |

## How each number was taken

- **TTFB by city.** `node scripts/perf/region-ttfb.mjs --url https://timeway.co/ahmedwasfie/30min --samples 9 --probes 3 --enforce false`.
  Globalping HTTPS GET; `firstByte` is measured after the TLS handshake. p75 is the inclusive quartile over all samples.
  Probes: Cairo (AS136907, AS154177), Riyadh (AS136907, AS202105), Dubai (AS9009, AS136258, AS207847, AS154177).
  No probe failed. Measured 2026-10-28T01:10:07Z.
- **Dubai TTFB by Cloudflare colo** (the cause of the miss): DXB 220-521 ms (5), MRS 237-383 (5), AMS 288-372 (6),
  CDG 414 (1), MCT 434-1074 (4), LHR 711-1146 (6). Every LHR sample is over budget, so AE traffic that lands on LHR or MCT
  fails the gate on its own. Cairo landed on ZRH/MRS, Riyadh on DMM/MRS. A curl series from the Dubai host (AS15802)
  landed on AMS 30/30 with TTFB p75 342 ms.
- **LCP / TBT on prod.** Lighthouse 13.5.0, default mobile profile (Moto G Power, simulated slow 4G, RTT 150 ms, CPU x4),
  5 runs against the live URL from a Dubai host (benchmarkIndex 2556-2637). LCP element is the event title `h1`;
  the breakdown in run 3 is TTFB 1146 ms (simulated) and element render delay 1652 ms, so LCP waits on JS hydration,
  not on bytes. FCP 1.6 s, Speed Index 6.0 s, TTI 7.1 s.
- **LCP / TBT on the CI build.** booking-perf run 40600454883 (push of d43cce3dda): Lighthouse 12.6.1, 5 runs per region,
  simulated RTT = slow 4G 150 ms plus the city RTT measured by Globalping (cairo 45, riyadh 9, dubai 113 ms).
- **JS.** The 6c gate output on the deploy SHA (`js-budget-gh-runner.json` in run 40600454883): 857.5 KB gz,
  ratchet 857.6 ok, 200 KB budget breach. The JS reductions in timeway#125, #126, #127, #130, #154 are open and not deployed;
  their measured stack result was 671.3 KB gz (t_f7b329bb), still over 200.
- **Slot API.** 30 sequential GETs of the exact `/api/trpc/slots/getSchedule` URL the deployed booker requested in
  Lighthouse run 2 (usernameList ahmedwasfie, 30min, 2026-09-30 to 2026-11-30, Asia/Dubai), all 200.
  The same call from the three cities through Globalping was refused with 429 (anonymous hourly limit); the repo has
  no `GLOBALPING_TOKEN` secret. The Dubai-host number is recorded as the measurement of record.
- **RUM.** The live page HTML contains no Plausible script and no `Server-Timing` header: WC-TW-9a (timeway#89),
  9c (#101), 6a (#105) and 6a3 (#115) are open drafts, not on main.

## Re-run

1. Region TTFB: `GLOBALPING_TOKEN=... node scripts/perf/region-ttfb.mjs --url https://timeway.co/ahmedwasfie/30min --samples 9 --probes 3 --enforce false --out perf/out/region-ttfb.json`
   (or `workflow_dispatch` of Booking perf gates, which enforces 500 ms).
2. LCP/TBT/JS on the CI build: the `build-gates` job of the same workflow on the deploy SHA.
3. Prod Lighthouse: `lighthouse https://timeway.co/ahmedwasfie/30min --only-categories=performance --form-factor=mobile --throttling-method=simulate --output=json` x 5, median.
4. Record the new row set here with its deploy SHA; a row passes only on a measured number.
