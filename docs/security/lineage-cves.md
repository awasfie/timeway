# Lineage security verification (WC-TW-1, proof CC-63)

Bible v12.6 WC.2.4 WC-TW-1. Timeway is a cal.com / cal.diy descendant. For each advisory named on the card, this file records the upstream fix and the `awasfie/timeway` file:line that carries it. The guard `scripts/security/lineage-floor.mjs` fails CI if any of these regress (`.github/workflows/lineage-security.yml`).

Baseline: `origin/main` 2f84ea2b9e (the image `timeway-web` runs, `next-server (v16.3.7)`), which contains upstream calcom/cal.com commit `421936dc14`.

| Advisory | Upstream fix | Timeway, file:line | State |
|---|---|---|---|
| **GHSA-9r3w-4j8q-pw98** / CVE-2025-66489: TOTP code skipped the password check (cal.com ≤ 5.9.7, fixed 5.9.8) | `authorize()` verifies the password whenever a hash exists; users without a hash are refused | `packages/features/auth/lib/next-auth-options.ts:206` (no hash → `IncorrectEmailPassword`), `:211` (`verifyPassword` unconditionally, before any 2FA branch) | Fixed (inherited); covered by `next-auth-options.test.ts` "Password validation" (6 cases incl. TOTP-without-hash) |
| **GHSA-7hg4-x4pr-3hrg** / CVE-2026-23478: `session.update({ email })` let a client set any email in the JWT; lookups by `token.email` then authenticated as the victim (3.1.6 ≤ v < 6.0.7) | 6.0.7 `421936dc14`: `getServerSession` resolves the user by `token.sub`. The JWT `update` branch upstream **still copies `session.email`** (checked against calcom/cal.com and calcom/cal.diy main, 2026-10-06) | Inherited: `packages/features/auth/lib/getServerSession.ts:72` (`findUnique({ where: { id: userId } })`). **Added by this PR:** `next-auth-options.ts:152` `resolveUpdatedTokenEmail` used at `:468`. A client-supplied email is accepted only if it equals the DB email of `token.sub`'s own user (the verify-email-change flow writes the DB first). API v2 also looked users up by `token.email`, so both were moved to `token.sub` with an email cross-check: `apps/api/v2/src/modules/auth/strategies/api-auth/api-auth.strategy.ts:313`, `apps/api/v2/src/modules/auth/strategies/next-auth/next-auth.strategy.ts:33` | Fixed. RED→GREEN: the 5 new tests "JWT callback trigger=update (CVE-2026-23478)" (4 fail on the unfixed source, 5/5 pass with the fix) |
| **GHSA-vgj7-76cw-h6f8**: booking-question labels rendered with `dangerouslySetInnerHTML` on `/booking/<id>` (≤ 4.7.15, fixed 4.7.16) | Labels pass through `markdownToSafeHTML` (`sanitize-html`) | `apps/web/modules/bookings/views/bookings-single-view.tsx:826` (`__html: markdownToSafeHTML(label)`), `packages/lib/markdownToSafeHTML.ts:15` (`sanitizeHtml`) | Fixed (inherited). Remaining `dangerouslySetInnerHTML` sinks in apps/web are static or operator-configured scripts, not visitor input |
| **CVE-2025-55182** (GHSA-fv66-9v8q-g76r, React Server Components RCE) + **CVE-2025-66478** (GHSA-9qr9-h5gf-34mp, Next.js flight protocol) via cal.com GHSA-qjx2-5xqp-cpf4 (≤ 5.9.8, fixed 5.9.9) | Upgrade Next.js / `react-server-dom-*` to patched releases | `yarn.lock`: `next` 16.3.7 (apps/web; floor for 16.x is 16.0.7) and 15.5.27 (apps/docs, example app; floor 15.5.7). No `react-server-dom-*` package is resolved (Next vendors its own patched copy). `react` 18.2.0 (apps/web), 19.2.4/19.2.5 elsewhere | Fixed. GitHub advisory DB, 2026-10-06: 0 advisories affect `next@16.3.7`, `next@15.5.27`, `next-auth@4.24.15` |

## Guard

`node scripts/security/lineage-floor.mjs` checks the following. CI runs it on every PR and on main.
1. Version floors from `yarn.lock`. Every resolved `next` / `react-server-dom-*` copy must be at or above the patched release of its own line. `next-auth` must be ≥ 4.24.15 (the pinned baseline), so a downgrade fails.
2. Source guards for the three code-level fixes above (required pattern present, vulnerable pattern absent).

Output at the time of this PR: `lineage-floor: 9 pass, 0 fail`.

## Alerts

`.github/dependabot.yml` enables weekly npm security updates and GitHub Actions updates. Dependabot alerts and security updates are turned on in the repository settings (see the PR for the API ids).
