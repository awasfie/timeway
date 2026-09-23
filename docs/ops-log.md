# Fork Ops Log (D-R39)

Provenance record for the Timeway fork, tracked separately from the
README's summary (README.md § "Fork base / ops log (D-R39)") per
criterion 9 of the rebase audit (PR #9, salesos#57).

## 2026-09 — Cal.diy re-base

- **Upstream repository:** [calcom/cal.diy](https://github.com/calcom/cal.diy)
- **Upstream base commit:** `54343aa685` (post-relicense, 100% MIT, zero `ee/` trees)
- **License state at that SHA:** root `LICENSE` is byte-identical MIT to
  upstream's post-relicense `LICENSE`; no `Cal.com Commercial License`
  headers anywhere in the tree; `packages/features/ee/`,
  `apps/web/modules/ee/`, and `ee/LICENSE` all absent (0 paths).
- **Rebase branch:** `rebase/caldiy-54343aa685`
- **Verification:** `git merge-base --is-ancestor` confirms the base commit
  is a genuine descendant of the pre-relicense upstream tip and an
  ancestor of both `main` and the rebase branch. Whole-tree brand/legal
  scan re-run mechanically on each landing candidate (see PR #9 review
  history for the full criterion 1-9 breakdown).
