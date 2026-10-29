# WC-TW-6l-1: why first paint waits in late booking runs (WIP)

Card t_c1423e83 (split 1 of 2 from t_063d46b1). Prod `a27b36f7d7`,
`https://timeway.co/ahmedwasfie/30min`, Lighthouse 13.5.0 mobile, Dubai host.
Status: WIP. Evidence so far from 6 traces (`lh-{1..6}-0.trace.json`, run 5817).

## Trace facts (ms from navigationStart)

| run | doc request | 3 CSS done | DCL | pagereveal | FP |
|-----|-------------|-----------|-----|------------|-----|
| 1 | 548 | ~890 | ~893 | ~1050 | 1059 |
| 2 | 537 | ~928 | ~930 | ~980 | 985 |
| 3 | 484 | ~837 | 851 | 1871 | 1879 |
| 4 | 577 | ~1000 | ~1002 | ~1080 | 1088 |
| 5 | 515 | ~918 | ~919 | ~1040 | 1047 |
| 6 | 504 | 837 | 845 | 880 | 957 |

- Run 3 parses faster than every early run, then the renderer's compositor
  stops asking for main frames: `RequestMainThreadFrame` count between 400 and
  1900 ms is 2 in run 3 (1871, 1887) against 17-23 in runs 2 and 6. Main thread
  is mostly idle in that gap. Rendering is held, not slow.
- Preload render-blocking status (`PreloadRenderBlockingStatusChange`):
  - early runs: `14t3zxdqqrj2q.js` goes `potentially_blocking -> non_blocking`
    and the woff2 preloads change status at 838-980 ms, then reveal follows;
  - run 3: neither event fires, and no `RemoteFontLoaded` either, although both
    woff2 bodies finished at 679/842 ms.
- Chromium (blink `DocumentLoader::RemainingTimeToRenderBlockingFontMaxBlockingTime`)
  caps preloaded-font render blocking at navigationStart + 1500 ms.

## Open (next turns)
- Pin the exact holder in run 3 (font preload timer vs `14t3` potentially
  blocking script vs streamed Suspense `B:0`), reproduce >= 3 times, edge HIT vs
  STALE check, named fix.
