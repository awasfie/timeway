# WC-TW-6c-9c-2 import walk: i18n on the booking route first load (/[user]/[type])

Base: wt/t_bf71ff0c head 02bd8720bb (js-baseline 761.7 KB gz, run 39923900449).

## Where i18n enters

1. Translation payload (not JS chunks).
   - `apps/web/app/layout.tsx` calls `loadTranslations(locale, "common")` (full common.json: en 320 KB raw / 85 KB gz;
     ar = en merged with ar, ~416 KB raw) and passes it as a prop to the client `AppRouterI18nProvider`. The whole
     dictionary is serialised into the RSC flight data inlined in the HTML of every booking page.
   - `apps/web/app/(booking-page-wrapper)/[user]/[type]/page.tsx` (and embed, booking/[uid], team pages) pass the
     full dictionary a second time through `CustomI18nProvider` when the event pins `interfaceLanguage`.
   - `scripts/perf/booking-js-budget.mjs` counts only `<script src>` / preload chunks, so this inline payload is
     invisible to the ratchet today. Cutting it lowers HTML/LCP, not `total_kb_gz`.
2. i18next runtime (JS chunks, counted).
   - `packages/lib/hooks/useLocale.ts` imports `createInstance` (i18next) and `useTranslation` (react-i18next)
     eagerly; `useClientLocale` (react-i18next path) runs unconditionally even though app-router pages only use
     the context branch. react-i18next + its context therefore ship on the booking first load.
   - `apps/web/app/layout.tsx` imports `dir` from i18next server-side only (no client cost).
   - next-i18next (`apps/web/lib/app-providers.tsx`) is pages-router only, not on this route.

## Cut (next slice)

a. Server-built booker subset: a generated key list for the Booker tree (static `t("...")` literals under
   packages/features/bookings/Booker, apps/web/modules/bookings/components, schedules/calendars used by Booker, plus
   dynamic keys: form-builder default labels, `t(status)` maps, `_one/_other` plural forms and `$t()` nesting),
   filtered server-side in `@calcom/i18n/server` (`loadTranslationSubset`) for en and ar; root layout and the
   booking pages pass the subset on booking paths; other keys load lazily on demand.
b. `useLocale`: move the react-i18next client fallback into a pages-router-only module so the app-router path
   ships i18next `createInstance` only.
c. Gate: add inline flight-data bytes (HTML size) to the perf summary so (a) is measured; lower
   perf/js-baseline.json by the measured JS saving from (b).

Local build blocked this run: host node 26 breaks the prisma zod generator (`options.recursive`), and
homebrew node@22 fails to load (missing libsimdutf.33.dylib); measurement must run in CI (booking-perf.yml).
