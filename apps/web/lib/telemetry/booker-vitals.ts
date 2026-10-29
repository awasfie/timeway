import {
  isBookerAnalyticsEnabled,
  trackWebVital,
} from "@calcom/features/bookings/Booker/utils/bookerAnalytics";

// WC-TW-6i: field INP + LCP from the public booking page to first-party Plausible. web-vitals is
// imported lazily so the booking route's first-load JS does not grow (6c ratchet), and only when the
// Plausible queue stub is on the page (PLAUSIBLE_DOMAIN/HOST set), so nothing loads where it cannot send.

type VitalsModule = Pick<typeof import("web-vitals"), "onINP" | "onLCP">;

let started = false;

export function startBookerWebVitals(
  load: () => Promise<VitalsModule> = () => import("web-vitals")
): boolean {
  if (started || typeof window === "undefined" || !isBookerAnalyticsEnabled()) return false;
  started = true;
  load()
    .then(({ onINP, onLCP }) => {
      onINP(trackWebVital);
      onLCP(trackWebVital);
    })
    .catch(() => {
      started = false;
    });
  return true;
}

export function resetBookerWebVitals() {
  started = false;
}
