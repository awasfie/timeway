import {
  isBookerAnalyticsEnabled,
  trackWebVital,
} from "@calcom/features/bookings/Booker/utils/bookerAnalytics";
import { onLCP } from "web-vitals";

// WC-TW-6i: field INP + LCP from the public booking page to first-party Plausible.
// onLCP reuses the "web-vitals" module the root layout already ships (RumBeacon), so it adds nothing to
// the first load. onINP is the deep module imported lazily: a dynamic import of the package root would
// stop tree-shaking of that shared module and grow the booking route's first-load JS (6c ratchet).
// Nothing starts unless the Plausible queue stub is on the page (PLAUSIBLE_DOMAIN/HOST set).

type OnINP = typeof import("web-vitals/onINP.js").onINP;
type Deps = { onLCP: typeof onLCP; loadINP: () => Promise<{ onINP: OnINP }> };

const defaultDeps: Deps = { onLCP, loadINP: () => import("web-vitals/onINP.js") };

let started = false;

export function startBookerWebVitals(deps: Deps = defaultDeps): boolean {
  if (started || typeof window === "undefined" || !isBookerAnalyticsEnabled()) return false;
  started = true;
  deps.onLCP(trackWebVital);
  deps
    .loadINP()
    .then(({ onINP }) => onINP(trackWebVital))
    .catch(() => undefined);
  return true;
}

export function resetBookerWebVitals() {
  started = false;
}
