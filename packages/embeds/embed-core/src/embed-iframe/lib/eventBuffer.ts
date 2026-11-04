import { sdkActionManager } from "../../sdk-event";

/**
 * WC-TW-6n-1b: the embed runtime (../runtime.ts) is fetched lazily, so the booker can fire SDK events (e.g.
 * `__dimensionChanged`, `bookerViewed`) before the runtime has registered its parent-forwarding listener.
 * The loader starts this buffer synchronously at page load in embed mode; the runtime drains it once and
 * forwards the buffered events to the parent, in order.
 */
type BufferedDetail = CustomEvent["detail"];

let buffered: BufferedDetail[] | null = null;
let listener: ((e: CustomEvent) => void) | null = null;

export function startBufferingEvents() {
  if (buffered || !sdkActionManager) {
    return;
  }
  buffered = [];
  listener = (e: CustomEvent) => {
    buffered?.push(e.detail);
  };
  sdkActionManager.on("*", listener as never);
}

/** Stops buffering and returns everything captured so far (empty if buffering never started). */
export function drainBufferedEvents(): BufferedDetail[] {
  if (listener && sdkActionManager) {
    sdkActionManager.off("*", listener as never);
  }
  const events = buffered ?? [];
  buffered = null;
  listener = null;
  return events;
}
