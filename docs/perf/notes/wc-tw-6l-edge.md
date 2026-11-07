# WC-TW-6l-1a: does edge HIT vs STALE explain the late first paint?

Card t_967369b1 (split of t_c1423e83, parent WC-TW-6l t_063d46b1). Prod `a27b36f7d7`,
`https://timeway.co/ahmedwasfie/30min`, Lighthouse 13.5.0 mobile simulated, headless Chrome,
Dubai host, 2026-10-30 23:36-23:55 +04. Worker: `ops/cloudflare/worker/booking-edge.mjs`
(FRESH_S 60, MAX_STALE_S 300). Follows `wc-tw-6l-diagnosis.md`; does not redo it.

## Verdict

**Edge does not explain the late first paint.** In every late HIT or STALE run the document
arrives, finishes and parses at the same time as in the early runs (response 507-529 ms, finish
656-681 ms, DCL 844-891 ms); only the paint moves (1803-2815 ms). Late runs occur under HIT
(1 of 5) and STALE (3 of 6); that split is not significant (Fisher exact, one-sided p = 0.35, n = 11).
The one MISS run is slow for a different, known reason (origin round trip). No Worker change.

## What the Worker sends, HIT vs STALE vs MISS

Read from the code and checked on the wire:

- HIT and STALE return the same stored `Response` (`toClient(hit, ...)`); STALE only adds a
  `ctx.waitUntil(refresh(...))` that runs after the client response is returned. Same body bytes,
  same headers apart from `x-tw-edge` and `age`.
- Headers per LH document (devtools log, all 12 runs): h2, `content-encoding: br`, `Link:` preload
  header present (2 woff2 + 3 CSS), encoded header length 884-894 B (MISS 864).
  `cf-cache-status` is `HIT` for both HIT and STALE, `DYNAMIC` for MISS.
- Transfer: LH doc `transferSize` 95.7-96.4 KB for HIT/STALE, 99.6 KB for MISS. curl (br, gzip)
  106.7-107.9 KB HIT/STALE, 111.1-111.3 KB MISS.
- Streaming/flushing: identity fetch, `Transfer-Encoding: chunked`. MISS: first byte 537 ms,
  `</html>` 971 ms; HIT: first byte 182-186 ms, `</head>` in the first read, `</html>` 563-617 ms
  (408 KB uncompressed, 94-102 reads). No Suspense boundaries in the HTML (`B:0`/`S:0`/`$RC`
  absent), so nothing is held back for a later flush; a cached copy replays one complete document.
- Early hints: none. `curl -v` shows only `HTTP/2 200`, no `103`.

## Lighthouse x12 (odd runs after a 65 s gap -> STALE expected, even runs immediately after -> HIT)

Times in ms from navigationStart, from the saved trace (observed, not simulated).

| run | x-tw-edge | age s | doc resp | doc finish | DCL | obs FCP | sim FCP | TTFB audit | late |
|-----|-----------|-------|----------|-----------|-----|---------|---------|-----------|------|
| 1 | STALE | 80 | 511 | 668 | 857 | 2815 | 2092 | 169 | yes |
| 2 | HIT | 15 | 519 | 673 | 888 | 921 | 1636 | 175 | |
| 3 | STALE | 94 | 509 | 657 | 874 | 998 | 1597 | 170 | |
| 4 | HIT | 14 | 511 | 663 | 844 | 2811 | 2104 | 178 | yes |
| 5 | STALE | 94 | 527 | 673 | 852 | 911 | 1623 | 196 | |
| 6 | HIT | 13 | 511 | 655 | 860 | 893 | 1632 | 185 | |
| 7 | STALE | 93 | 507 | 656 | 882 | 1823 | 2077 | 170 | yes |
| 8 | HIT | 13 | 536 | 687 | 907 | 955 | 1588 | 195 | |
| 9 | MISS | 0 | 920 | 1170 | 1691 | 1842 | 1917 | 860 | yes |
| 10 | STALE | 109 | 866 | 1025 | 1252 | 1387 | 1733 | 508 | |
| 11 | STALE | 79 | 529 | 681 | 891 | 1803 | 2074 | 196 | yes |
| 12 | HIT | 13 | 500 | 648 | 864 | 934 | 1633 | 174 | |

Late = observed FCP > 1500.

| status | runs | late | early | late doc finish | early doc finish |
|--------|------|------|-------|-----------------|------------------|
| HIT | 5 | 1 | 4 | 663 | 648-687 |
| STALE | 6 | 3 | 3 | 656-681 | 657-1025 |
| MISS | 1 | 1 | 0 | 1170 | - |

- Late HIT/STALE runs: DCL 844-891 ms, FCP 1803-2815 ms, a 0.9-2.0 s gap with the document
  fully parsed. Same signature as run 3 of the diagnosis note (parse done, reveal held).
- Runs 1 and 4 paint at ~2.81 s, past the 1500 ms preloaded-font cap named in the diagnosis
  note, so the font cap alone does not bound the hold. Handed to 6l-1b.
- Run 10 (STALE) shows a slow document (TTFB 508) yet paints early; slow delivery and late paint
  do not track each other.

## curl x30 (Accept-Language `de`, own cache key; runs 11-20 after 65 s gaps)

- HIT (n = 18): ttfb 468-688 ms via LHR colo, 48-104 ms via DXB colo; STALE (n = 10): ttfb
  461-545 ms (all LHR); MISS (n = 2): 895 ms LHR, 613 ms DXB.
- HIT vs STALE TTFB ranges overlap completely; STALE costs the client nothing.
- Side finding, not this card: the same Dubai host lands on LHR for 25 of 30 requests and DXB for
  5 (`cf-ray` suffix). An LHR hit costs ~450 ms more TTFB than a DXB hit. It does not explain the
  paint hold (late and early runs were all LHR except MISS run 9) but it is a real latency cost
  for Gulf visitors; worth its own card under WC-TW-6.

## Evidence

- LH: 12 JSON + trace + devtools logs, `~/.hermes/cache/scratch/tw6l1a/lh{1..12}*` (scratch,
  pruned after 24 h idle). Document `cf-ray` per run in the devtools logs.
- curl: `curl.log` / `curl.status` beside them; rays `a52cde48ba2063de-LHR` (run 1 MISS) through
  `a52cef249b144a1f-DXB` (run 30).
- Chunk timing: `chunks.py` (raw TLS socket, identity encoding).

## Next

6l-1b pins the render holder (font preload timer vs potentially-blocking `14t3` script vs other)
using late-run traces 1, 4, 7, 11 above; 6l-2 measures the fix. Edge is excluded.
