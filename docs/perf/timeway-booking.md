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

## WC-TW-6e: why Dubai TTFB misses (card t_a47ce8d0, 2026-10-28 03:40 to 04:10Z)

Still **not met**; this section is the diagnosis and the chosen fix, not a pass. Raw samples:
`evidence/2026-10-28-wc-tw-6e-dubai-colo.json` (Globalping, Dubai+AE, 3 rounds x 6 probes, page and an edge-cached
asset from the same probes in the same minute).

| Dubai+AE, 18 samples each | p50 | p75 | by colo (min-max ms) |
| --- | ---: | ---: | --- |
| booking page `/ahmedwasfie/30min` (`cf-cache-status: DYNAMIC`) | 658.5 | 1230 | MCT 314-1737, MRS 442-1362, AMS 432-1277, LHR 676-966, NRT 1090-1474, CDG 624 |
| `/favicon.ico` (`HIT`, same probes) | 72 | 143 | MCT 16-27, DXB 10-13, MRS 117-124, AMS 135-146, CDG 128, NRT 173, LHR 456-784 |

Findings:

1. **The colo is not the cause.** From the same probes, an edge `HIT` answers in 10-27 ms on MCT/DXB and 117-173 ms on
   MRS/AMS/CDG/NRT. Every page miss pays the full trip to the origin in Germany (62.171.141.202) plus the render, from
   every colo. The page is `private, no-store` and `DYNAMIC`, so no colo can answer it.
2. **Origin render is fine when measured on the host:** 80-200 ms through Traefik on 62.171.141.202 (15 samples
   110-199 ms, TLS on loopback 20-25 ms). The rest of the 300-1700 ms is the colo-to-Germany leg and its variance
   (MCT went from 434 ms at 01:10Z to 1737 ms at 03:58Z on the same probe).
3. **The LHR samples are one probe network, not Cloudflare routing:** every LHR sample is CloudBlast AS207847, whose TCP
   handshake to the edge alone is 463-1721 ms; its edge `HIT` on a 1 KB favicon is still 456-784 ms. No server change
   brings that probe under 500 ms. It is 1 of 6 Dubai probes (17%), so p75 can pass with it in the set.
4. **Cloudflare knobs on this zone (Pro):** Tiered Cache off, Regional Tiered Cache not on the plan (403), Argo Smart
   Routing not enabled (paid add-on, and it only shortens the colo-to-origin leg). Cache rules cannot key on
   `Accept-Language` (`forbidden header`) and custom cache keys are not on the plan (`not entitled`); both probed with a
   disabled rule that was removed (entrypoint back to version with only the two `tw6b_` rules).
5. **A Cloudflare Tunnel origin does not help:** a tunnel from the origin host (`edge-probe.timeway.co`, connectors in
   FRA) measured the same as the direct origin (Dubai 12 samples: tunnel MCT 492-879 / AMS 432-616 vs direct
   MCT 403-780 / AMS 288-517). Tunnel, DNS record, connector container and token were deleted after the test.

**Fix chosen (engineering decision, recorded on the card):** serve the anonymous booking-page HTML from the Cloudflare
edge with a Worker in front of `timeway.co/<user>/<type>`: Cache API key = URL + language bucket from `Accept-Language`
(the root layout picks `<html lang>` from it), bypass for any `next-auth.session-token` cookie, any query string other
than a known-safe list, non-GET, and non-200; short TTL with background revalidation so event edits show within a
minute. Expected Dubai TTFB = edge hit time above (p75 143 ms on the favicon). The HTML carries no per-visitor data for
anonymous visitors (no CSP nonce on platform-host booking paths: `proxy.ts` passes them through; country is used only
for authenticated analytics identify; two anonymous `en` fetches 03:41Z were byte-identical, 353165 bytes, `nonce=""`;
an `ar` fetch differed, 458304 bytes, `lang="ar"`). Built and proven on the follow-up card named in the card thread.

## WC-TW-6g: booking HTML served from the edge (card t_682a1117, 2026-10-28 06:31Z)

Dubai TTFB gate **met** on this measurement. Worker `timeway-booking-edge` (bundle `eaacb21f97b074ce`, source
`ops/cloudflare/worker/booking-edge.mjs` at `b421e77db9`) on `timeway.co/*`, with no-worker routes for `_next`, `api`,
`trpc`, `auth`, `ingest`, `apps`, `settings`, `bookings`, `event-types`, `availability`, `fonts`, `icons`
(`ops/cloudflare/timeway-worker.json`). Raw samples: `evidence/2026-10-28-wc-tw-6g-edge-worker.json`
(Globalping, 6 rounds x 3 probes per region, all 200).

| region, 18 samples each | p50 | p75 | max | by colo (min-max ms) |
| --- | ---: | ---: | ---: | --- |
| Cairo+EG | 71 | 77 | 94 | ZRH 65-94, MRS 55-83 |
| Riyadh+SA | 95 | 99 | 125 | MRS 85-125 |
| Dubai+AE | 154.5 | 188 | 1067 | MCT 45-686, MRS 121-143, AMS 149-188, LHR 595-680, NRT 1067 |

Dubai p75 went from 1230 ms (WC-TW-6e, page `DYNAMIC`) to 188 ms. The LHR samples are the CloudBlast probe from 6e
finding 3; NRT and the slow MCT sample are first requests at a colo with no copy yet (a miss pays the origin trip).

What the Worker does (unit tests `node --test ops/cloudflare/worker/booking-edge.test.mjs`, 10 pass):

- Caches only `GET`/`HEAD` `/<user>/<type>` (no trailing slash, no extension, first segment not an app route), no
  query other than `utm_*`, no `next-auth.session-token` cookie, no `Authorization`, no RSC/Next router headers, and
  only a 200 `text/html` without `Set-Cookie`. Everything else is `x-tw-edge: BYPASS` or untouched.
- Key = path + language bucket. The bucket is what `getLocale.ts` resolves for a visitor with no session (same
  parser steps and `bcp-47-match` lookup over `i18n.json`; 21 headers checked against the real libraries, 0
  differences); unsupported languages collapse to `en`. On a miss the origin gets `Accept-Language: <bucket>` and no
  cookie.
- Fresh 60 s, then served stale while one background refresh runs, until 300 s; a refresh that gets non-200 evicts.
  Browsers still get `private, no-cache, no-store`, so only the edge keeps a copy. Header `x-tw-edge: HIT|STALE|MISS`.
- The cached HTML carries the first visitor's `cf-ipcountry` in the GeoProvider payload; its only reader
  (`AnalyticsIdentify`) acts for authenticated sessions, which bypass the cache.

Live checks after apply: `en` MISS then HIT, two HITs byte-identical; `ar` renders `lang="ar" dir="rtl"`, a second `ar`
header variant is a HIT on the same entry; bogus session cookie, `?month=`, unknown event (404) are BYPASS; `/`,
`/auth/login`, `/api/version`, `/apps/installed`, `/favicon.ico` unchanged (no `x-tw-edge`).

Operate: `CLOUDFLARE_API_TOKEN=... python3 ops/cloudflare/worker.py plan|apply --yes|rollback --yes [--delete-script]`
(token `CLOUDFLARE_TIMEWAY_WORKER_TOKEN`, Infisical `platform:/cloudflare`). Rollback deletes the routes, so traffic
goes straight to the origin at once (exercised 06:40Z: rollback -> page `DYNAMIC`, no `x-tw-edge`; re-apply -> `plan`
shows no changes and the page is served from the edge again).

## Re-run

1. Region TTFB: `GLOBALPING_TOKEN=... node scripts/perf/region-ttfb.mjs --url https://timeway.co/ahmedwasfie/30min --samples 9 --probes 3 --enforce false --out perf/out/region-ttfb.json`
   (or `workflow_dispatch` of Booking perf gates, which enforces 500 ms).
2. LCP/TBT/JS on the CI build: the `build-gates` job of the same workflow on the deploy SHA.
3. Prod Lighthouse: `lighthouse https://timeway.co/ahmedwasfie/30min --only-categories=performance --form-factor=mobile --throttling-method=simulate --output=json` x 5, median.
4. Record the new row set here with its deploy SHA; a row passes only on a measured number.
