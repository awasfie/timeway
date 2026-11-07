# WC-TW-6l-1b: what holds first render in late booking runs

Card t_4b8b42e5 (split from t_c1423e83). Builds on `wc-tw-6l-diagnosis.md`
(same branch base `cd62ed49a0`); read that first.
Target `https://timeway.co/ahmedwasfie/30min`, live on 2026-10-30 (`x-tw-edge`
HIT/STALE/MISS mixed), Dubai host, Chrome for Testing 156.0.8078.47 headless,
Lighthouse 13.5.0 mobile simulated.

## Verdict

1. The run-3 late hold (DCL 851 ms, first paint 1879 ms) did **not reproduce**:
   0 late runs out of 107 (30 Lighthouse runs, 77 puppeteer runs). The worst
   DCL-to-first-paint gap seen anywhere was 253 ms. The card asked for at least
   3 late runs before flipping mechanisms; that bar was not met, so none of the
   three candidates can be confirmed as the run-3 holder from a trace.
2. Flipping each candidate in normal runs moves the hold by less than the noise
   between batches, so none of them is a steady holder either (table below).
3. What the code and traces rule out:
   - (ii) `<link rel=preload as=script>`: every app script is `async`, so a
     script preload is never render-blocking. The trace shows it as
     `potentially_blocking` and then `non_blocking` within about 30-350 ms of
     the document. The page now ships `41-p5x8i94rqo.js` with
     `fetchPriority=low` (it replaced `14t3zxdqqrj2q.js`). Dropping it changed
     nothing measurable.
   - (iii) streamed Suspense `B:0`: the boundary sits inside `<div hidden>` with
     an empty fallback, and `$RC("B:0","S:0")` only swaps hidden nodes. React's
     `$RT` reveal throttle (the `2300 - now` timer) applies to `B:1`, which is
     shown after first paint. Removing `B:0` + `S:0` changed nothing
     measurable.
   - (i) preloaded-font blocking: this is the only one of the three that is
     active on the page. Both woff2 files arrive as `Link: rel=preload;
     as=font` (Inter, and CalSans with `display: block`) and Chromium blocks
     rendering for preloaded fonts. But Chromium caps that block at
     navigationStart + 1500 ms, and run 3 painted at 1879 ms. The run-3
     signature used to suspect it (no woff2 `PreloadRenderBlockingStatusChange`,
     no `RemoteFontLoaded`) also shows up in 6 of 8 normal base runs that
     painted at 473-650 ms. That signature does not mark a late run.
4. Best remaining explanation for run 3: frame production stalled in the
   renderer, not a render-blocking resource. The compositor stopped sending
   `RequestMainThreadFrame` for about 1.4 s while the main thread was idle
   (diagnosis note). None of the three mechanisms reaches past the 1500 ms font
   cap. This is an inference with no trace to prove it, and it points at the
   measuring harness (a headless BeginFrame/occlusion pause) more than at the
   page.

## Flip results (puppeteer, CDP `Fetch` rewrite of the document only)

`hold` = first-paint minus DCL (ms). Two batches run back to back, same host.
Rows where the rewrite did not match were excluded (`changed=false`; batch 1
`nosuspense0` had a regex miss in 9/10 runs).

| variant | batch 1 n / hold med / max | batch 2 n / hold med / p90 / max |
|---|---|---|
| base (rewrite on, no change) | 13 / 121 / 147 | 16 / 48 / 141 / 158 |
| raw (no interception) | 12 / 108.5 / 169 | - |
| no font preload (Link header + tags) | 10 / 31.5 / 117 | 16 / 80 / 124 / 234 |
| no script preload | 10 / 73 / 166 | 16 / 67.5 / 154 / 172 |
| no hidden Suspense B:0 | 1 / 151 / 151 | 14 / 86.5 / 123 / 167 |

In batch 1, removing the font preload looked like a win (31.5 vs 121). Batch 2
reversed it (80 vs 48). The difference is noise.

## Lighthouse repro attempt (30 runs)

DCL / first paint (ms): runs 1-10 and 28-30 (slower network window) DCL
1176-1509, hold -9..184; runs 11-27 DCL 543-690, hold -6..168. No run went past
the 1500 ms font cap with an idle main thread. Edge state cycled through
HIT/STALE/MISS and did not track the hold.

## Lead for 6l-2 (outside this card's question)

The same 30 runs give simulated LCP median 4678 ms, p75 4730 ms (range
2236-6094), while simulated FCP has median 1586 ms. Late LCP is the main
problem, and first paint is not what delays it. Run 10's LCP element is the
client booker title `h1[data-testid=event-title]`
(`div.[grid-area:meta] … h1.text-text`), not the SSR shell h1. Its LCP
breakdown is TTFB 929 ms + element render delay 1478 ms. That element is
revealed through the streamed `B:1` boundary, which goes through React's `$RC`
reveal throttle (`$RT + 300 ms`, or wait until 2300 ms when the reveal lands
between 2000 and 2300 ms). Then it renders inside an `animate-in` wrapper.
6l-2 should check those two delays first.

## Named fix (for 6l-2)

There is no proven app-side holder, so the fix below is **conditional**. It
removes the only active render-blocking path of the three. It cannot add
blocking, and it is a one-file change if 6l-2 wants a defensive step:

- `apps/web/app/layout.tsx:20-27`: set `preload: false` on `calFont`, which
  drops the CalSans `Link: rel=preload; as=font`; keep `display: "block"` only
  if headings must never flash. Inter stays preloaded with `display: "swap"`,
  which is render-blocking only until the 1500 ms cap.
- The same `localFont` block in `apps/web/components/PageWrapper.tsx:36`
  covers pages-router routes. Change both together or neither.

What 6l-2 should do instead of shipping on a guess: gate on the **median of 5**
Lighthouse runs, not a single run, and re-open this card only if 3 late runs
show up with traces. Then check `RequestMainThreadFrame` and BeginFrame source
events first. A gap with an idle main thread and no pending blocking resource
is a harness stall, not the page.

## Evidence

- Harness: `run.mjs` (variants `raw|base|nofont|noscriptpreload|nosuspense0`)
  and `an.py` (trace reader), under `~/.hermes/cache/scratch/tw6l1b`. Rows are
  in `out/rows.jsonl` and `b2/rows.jsonl`, Lighthouse JSON and traces in
  `lh/lh-{1..30}*`, summary in `lh/summary.txt`. Scratch is pruned after 24 h
  idle; the copied rows and scripts are archived at
  `/Volumes/ExtremePro/archive/wc-tw-6l-1b/`.
- Run-3 traces from run 5817 were already pruned before this card started. The
  run-3 facts come from `wc-tw-6l-diagnosis.md`.
