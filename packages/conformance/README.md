# @calcom/conformance — CC-64 calendar-sync soak

CC-64 asks: does Timeway's calendar sync hold up under real provider traffic for 14 straight UTC days? This package
is the harness that answers that. It books through prod `https://timeway.co` as a black box, using the same public
paths a booker uses (slots read, `reserveSlot`, `POST /api/book/event`, cancel). It never touches Timeway's DB.
Provider calendars (Google Calendar, Microsoft Graph) are read and written only through their REST APIs, using the
harness's own OAuth refresh tokens.

## What CC-64 measures

- Double-bookings (S5a). An accepted booking that overlaps another accepted booking of the same host, or overlaps a
  `soak-busy-<id>` event that existed at the provider before the booking POST was sent. A 409 conflict rejection
  (hold or re-check) is correct behaviour and is never counted as an error.
- Orphans (S5b). An accepted booking with no provider event, or a Timeway-written provider event with no accepted
  booking, judged after a 10 min settle.
- Sync lag (S5c). Time from a provider-side insert/delete of a busy event until the slot disappears from or reappears
  in Timeway's slots endpoint. Polled every 5 s; a sample that never flips within 15 min counts as 900 s. Reported as
  p50/p95 per day and per run.
- Day verdict (S9). A UTC day is green only if the runner had no gap > 60 min and was up >= 23 h, made >= 200 booking
  attempts, had 0 double-bookings, 0 orphans, and day lag p95 < 60 s. A red or missing day resets the streak.
- CC-64 PASS = 14 consecutive green days that contain one passing forced Google 410 drill and one passing Graph
  `subscriptionRemoved` drill (S6).

## Layout

- `src/http.ts`: fetch with typed errors; 429/5xx/network retried with jittered backoff (max 5 tries).
- `src/providers/google.ts`, `src/providers/graph.ts`: token refresh, busy-event insert/delete/list, Graph
  subscription list/delete and lifecycle notification.
- `src/timeway.ts`: booker client (`getSlots`, `reserveSlot`, `book`, `cancel`) and the accepted /
  rejected-conflict / rejected-other classification. `book` is never retried.
- `src/invariants.ts`: pure functions for S5 and S9, run over plain JSONL records.
- `src/load.ts`, `src/run.ts`, `src/report.ts`: added by the follow-up WC-TW-4 cards.

## Commands

    yarn workspace @calcom/conformance test        # vitest, mocked fetch, no network
    yarn workspace @calcom/conformance type-check

Tests never call prod or a provider: every client takes an injected `fetch`.
