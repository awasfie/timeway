import { sdkActionManager } from "../../sdk-event";

type EventDetail = CustomEvent["detail"];

let buffered: EventDetail[] | null = null;
const buffer = (e: CustomEvent) => buffered?.push(e.detail);

export function startBufferingEventsBeforeRuntime() {
  if (buffered || !sdkActionManager) {
    return;
  }
  buffered = [];
  sdkActionManager.on("*", buffer);
}

/**
 * Called synchronously by the runtime right before it subscribes to "*", so no event is lost or
 * forwarded twice between the two listeners.
 */
export function takeEventsFiredBeforeRuntime(): EventDetail[] {
  const events = buffered ?? [];
  if (buffered) {
    sdkActionManager?.off("*", buffer);
    buffered = null;
  }
  return events;
}
