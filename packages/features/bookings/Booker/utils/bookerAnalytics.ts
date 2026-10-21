// First-party Plausible events for the public Booker (WC-TW-9c). booking_confirmed is server-side only (9b).
export type BookerEventSource = "direct" | "embed";

export type BookerAnalyticsContext = {
  org: string | null;
  eventType: number | null;
  source: BookerEventSource;
};

type PlausibleFn = (
  name: string,
  options?: { props?: Record<string, string | number>; u?: string }
) => void;

const NO_CONTEXT: BookerAnalyticsContext = { org: null, eventType: null, source: "direct" };

let context: BookerAnalyticsContext = NO_CONTEXT;
let lastSlot: string | null = null;

function getPlausible(): PlausibleFn | null {
  if (typeof window === "undefined") return null;
  const fn = (window as unknown as { plausible?: PlausibleFn }).plausible;
  return typeof fn === "function" ? fn : null;
}

// Origin + path only: prefill params (email, name, notes, slot) never leave the browser.
export function sanitizedUrl(): string | null {
  if (typeof window === "undefined") return null;
  return `${window.location.origin}${window.location.pathname}`;
}

function props(): Record<string, string | number> {
  return {
    org: context.org ?? "none",
    event_type: context.eventType ?? 0,
    source: context.source,
  };
}

function send(name: string) {
  const plausible = getPlausible();
  const u = sanitizedUrl();
  if (!plausible || !u) return;
  plausible(name, { props: props(), u });
}

// Call once per Booker mount. Sends the manual pageview (sanitised URL) and the custom event.
export function trackBookerPageView(next: BookerAnalyticsContext) {
  context = next;
  lastSlot = null;
  const plausible = getPlausible();
  const u = sanitizedUrl();
  if (!plausible || !u) return;
  plausible("pageview", { u, props: props() });
  send("booking_page_view");
}

export function trackSlotSelected(slot: string | null) {
  if (!slot || slot === lastSlot) return;
  lastSlot = slot;
  send("slot_selected");
}

export function resetBookerAnalytics() {
  context = NO_CONTEXT;
  lastSlot = null;
}
