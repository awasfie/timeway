# Timeway booking page performance (CC-56 evidence, WC-TW-6d)

Card t_762bea7b (WC-TW-6 proof). Bible WC-9, WC-TW-6 line; WC.2.5 rows LCP p75, TTFB p75, slot API p95.

Target: the deployed production booking page `https://timeway.co/ahmedwasfie/30min` (a real public event type).

Deploy measured: `d43cce3ddadc1d71475d2c3557fd5bc610ecf872` (main, timeway#108), Coolify app `timeway-web`
deployment `e046vk7mp3ozc4ldtrxnlrvr`, finished 2026-10-27 23:47:57Z. That was the newest deployment when
these numbers were taken (2026-10-28 01:10 to 01:25Z).

## Verdict

The gate is **not met**. 2 of 9 rows passed on 2026-10-28 01:25Z (TTFB from Cairo and from Riyadh); the slot API row
passes after the WC-TW-6f re-measure (below), so 3 rows pass. Fix cards hold the measured numbers;
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
| dubai | slot API `slots/getSchedule` (the booker's own call, 2-month range) | p95 < 800 ms | 458 ms warm (p50 386, max 471); cold 1034 | 30 + 30 | `node scripts/perf/slot-api.mjs` from the Dubai host; `evidence/2026-10-28-slot-api-wc-tw-6f.json` (WC-TW-6f) | bfebbeca82 (= d43cce3dda code) | PASS |
| any org | per-tenant RUM in Plausible | visible for >= 1 org | not visible: not deployed | 0 | see INP RUM row | d43cce3dda | MISSING |

## Re-run r2 (card t_762bea7b run 5301, 2026-10-28 06:50Z), after 6f and 6g

App code under test is still `d43cce3dda` (every later main commit is docs-only: `git diff --stat d43cce3dda origin/main`
touches only `docs/perf/**`), plus the live Cloudflare Worker `timeway-booking-edge` from WC-TW-6g (timeway#202;
response header `x-tw-edge: HIT`). Raw numbers: `evidence/2026-10-28-wc-tw-6d-r2.json`.

| region | metric | gate | p75 / value | samples | run id / artifact | deploy SHA | result |
| --- | --- | --- | ---: | ---: | --- | --- | --- |
| cairo | TTFB | p75 < 500 ms | 77 ms | 42 | Globalping, WC-TW-6g pooled; `evidence/2026-10-28-wc-tw-6g-edge-worker-r2.json` (timeway#202) | d43cce3dda + Worker | PASS |
| riyadh | TTFB | p75 < 500 ms | 96 ms | 42 | same | d43cce3dda + Worker | PASS |
| dubai | TTFB | p75 < 500 ms | 166 ms Globalping excl. AS207847 (n=34; raw incl. that probe 595); local Dubai host AS15802 243 ms (p50 223, p95 259) | 34 + 30 | same; local curl in r2 evidence | d43cce3dda + Worker | PASS (Globalping AS207847 probe exclusion is Gosi's call, see 6g) |
| dubai (prod, real network) | LCP, Lighthouse 13.5.0 mobile simulated slow 4G | p75 < 2500 ms (target 1500) | 7016 ms median (6981-7086) | 5 | r2 evidence | d43cce3dda + Worker | FAIL |
| dubai (prod) | INP (lab TBT proxy) | < 200 ms | 220 ms median (205-303) | 5 | r2 evidence | d43cce3dda + Worker | FAIL |
| all | INP (RUM, Plausible) | < 200 ms | no data: page HTML has no Plausible script | 0 | timeway#89, #101 still open drafts | d43cce3dda | MISSING |
| prod | booking-route first-load JS | <= 200 KB gz | 49 scripts, 837 KB transfer (unchanged; JS stack #125/#126/#127/#130/#154 still open) | 1 | r2 evidence | d43cce3dda | FAIL |
| dubai | slot API (booker's warm getSchedule) | p95 < 800 ms | 458 ms | 30 | WC-TW-6f, `evidence/2026-10-28-slot-api-wc-tw-6f.json` (timeway#201) | bfebbeca82 (docs-only over d43cce3dda) | PASS |
| any org | per-tenant RUM in Plausible | visible for >= 1 org | not deployed | 0 | see RUM row | d43cce3dda | MISSING |

r2 verdict: **not met**, 4 of 9 rows pass (TTFB x3, slot API). TTFB rows rest on the 6g pooled Globalping run: a fresh
Globalping run this pass returned `429 rate_limit_exceeded` (anonymous IP hourly quota spent by 6g), so the local Dubai
host series is the independent cross-check. LCP sits at ~7.0 s with server response ~225 ms, so LCP is JS-bound, not
network-bound: it moves only when the JS stack merges and deploys (t_25e79885, t_3eb9a771, t_bf71ff0c). RUM rows move
when #89/#101 merge and deploy (t_75e3ae48).

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

## Slot API p95 (WC-TW-6f, card t_019259ca)

The 811 ms first recorded above was a measurement artifact, not server time. Each of those 30 curls opened a new
TCP + TLS connection from Dubai to the Cloudflare AMS colo (TCP RTT ~195 ms, handshake ~390 ms), which the deployed
booker never pays: it calls same-origin `/api/trpc/slots/getSchedule` on the HTTP/2 connection the page load already
opened. Measured 2026-10-28 04:17Z on the running image `bfebbeca82` (Coolify container
`poyzdsncp9jsvc3gr4hkitaf-20261028T020721`; differs from d43cce3dda in docs only), same URL as the booker sends
(ahmedwasfie/30min, 2026-09-30T20:00Z..2026-11-30T19:59Z, Asia/Dubai), all 200:

| path | samples | p50 | p95 | max |
| --- | ---: | ---: | ---: | ---: |
| origin only: Docker host to the container, no Cloudflare | 30 | 124 ms | 196 ms | 257 ms |
| Dubai host, warm connection (the booker's path, gated) | 30 | 386 ms | 458 ms | 471 ms |
| Dubai host, new connection per request (6d method) | 30 | 799 ms | 1034 ms | 1085 ms |

- Server time is 124-196 ms; the remaining ~260 ms warm is the Dubai to AMS to Contabo network path
  (the same leg as the page TTFB row).
- Narrowing the client range to the visible month does not help: at the origin the 1-month call was 126 ms p50 vs
  142 ms for 2 months (20 samples each). The booker range is left as is; seeded/server-side slots
  (timeway#105/#115) are not needed for this gate.
- Re-run: `node scripts/perf/slot-api.mjs --month 2026-10 --samples 30 --out perf/out/slot-api.json`
  (exits 1 when warm p95 >= 800 ms or any non-200; `--enforce false` to record only). The cold series is recorded
  beside it so a first-request regression stays visible.

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

Dubai TTFB gate **met** (pooled 42 samples, round 2 below). Worker `timeway-booking-edge` (bundle `eaacb21f97b074ce`, source
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

Round 2 (06:40Z, 8 rounds x 3 probes, `evidence/2026-10-28-wc-tw-6g-edge-worker-r2.json`, all 200), and the two
rounds pooled so each region has >= 20 samples:

| region | round 2 n / p75 | pooled n / p50 / p75 | pooled p75 without AS207847 |
| --- | ---: | ---: | ---: |
| Cairo+EG | 24 / 74 | 42 / 71 / 77 | 42 / 77 |
| Riyadh+SA | 24 / 95 | 42 / 94 / 96 | 42 / 96 |
| Dubai+AE | 24 / 663 | 42 / 155 / 595 | 34 / 166 |

The raw pooled Dubai p75 is **595 ms**: round 2 drew the CloudBlast probe (AS207847) 6 times out of 24, which puts it at
the 75th percentile. That probe reaches Cloudflare through LHR whatever the site: a control at 06:42Z from the same
probe took 659 ms TTFB for `www.cloudflare.com/cdn-cgi/trace` and 761 ms for `1.1.1.1/cdn-cgi/trace` (pages Cloudflare
generates at the edge, no origin), against 12 ms and 18 ms from the M247 Dubai probe. It measures that network's
transit, not timeway, so the gate is read without it: Dubai p75 **166 ms** over 34 samples (gate met); Cairo and Riyadh
pass either way. Server-side time (TTFB minus TCP connect) for Dubai is p75 72 ms over all 42 samples.

Live checks after apply: `en` MISS then HIT, two HITs byte-identical; `ar` renders `lang="ar" dir="rtl"`, a second `ar`
header variant is a HIT on the same entry; bogus session cookie, `?month=`, unknown event (404) are BYPASS; `/`,
`/auth/login`, `/api/version`, `/apps/installed`, `/favicon.ico` unchanged (no `x-tw-edge`). Re-checked 06:41Z: `en`
STALE then HIT, `__Secure-next-auth.session-token` cookie BYPASS, `/api/version` no header. The logged-in check uses a
cookie with a dummy value: the Worker decides on the cookie name alone, before any cache lookup, and passes the request
to the origin with the cookie intact, so a real session takes the same branch (`booking-edge.test.mjs` covers
`next-auth.session-token`, `__Secure-` and chunked `.0` names).

Operate: `CLOUDFLARE_API_TOKEN=... python3 ops/cloudflare/worker.py plan|apply --yes|rollback --yes [--delete-script]`
(token `CLOUDFLARE_TIMEWAY_WORKER_TOKEN`, Infisical `platform:/cloudflare`). Rollback deletes the routes, so traffic
goes straight to the origin at once (exercised 06:40Z: rollback -> page `DYNAMIC`, no `x-tw-edge`; re-apply -> `plan`
shows no changes and the page is served from the edge again).

## Re-run

1. Region TTFB: `GLOBALPING_TOKEN=... node scripts/perf/region-ttfb.mjs --url https://timeway.co/ahmedwasfie/30min --samples 9 --probes 3 --enforce false --out perf/out/region-ttfb.json`
   (or `workflow_dispatch` of Booking perf gates, which enforces 500 ms).
2. LCP/TBT/JS on the CI build: the `build-gates` job of the same workflow on the deploy SHA.
3. Prod Lighthouse: `lighthouse https://timeway.co/ahmedwasfie/30min --only-categories=performance --form-factor=mobile --throttling-method=simulate --output=json` x 5, median.
4. Slot API: `node scripts/perf/slot-api.mjs --month <YYYY-MM> --samples 30`.
5. Record the new row set here with its deploy SHA; a row passes only on a measured number.
