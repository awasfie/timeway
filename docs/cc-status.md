# Timeway CC status

One row per Bible completion criterion this repo carries. A deviation names the card that decided it and the condition that ends it.

| CC | What | State | Deviation | Ends when |
|----|------|-------|-----------|-----------|
| CC-56 | UX.13.3 budgets gated in CI (Design QA, `qa/design/`), ratchet baseline `qa/design/lhci-baseline.json` `ci`, a >10% regression over baseline fails | Gate live; every surface still over budget on LCP/JS, so the baseline x (1 + tolerance) is the error and the budget a warning | `tolerance.tbt_ms` = 1.0, not 0.1. GitHub runners come in two CPU classes (Lighthouse benchmarkIndex ~1700 vs ~2900-3065 in run 43320245511) and TBT swings 1.35-1.61x at the same code; a fresh `next start` also made run #1 of every surface a 3-10x TBT outlier until the UX.13.3-1 warm-up. Decided by Gosi on t_cd6258ed; recorded by t_100c9363. | Back to 0.1 once TBT is measured on a pinned runner class, or as a median over more runs, with the run-to-run TBT spread over 2 consecutive PR runs <= 10% of the median (per-run benchmarkIndex is in `out/lhci-medians.json`). |
