import { sdkActionManager } from "../sdk-event";
import { startBufferingEventsBeforeRuntime } from "./lib/pre-runtime-events";
import { isBrowser } from "./lib/utils";

// The iframe<->parent runtime (../embed-iframe.ts, ~10 KB gz) is only needed inside an embed. Importing
// sdk-event has run embed-iframe-init, so window.isEmbed() is defined here; outside an embed the runtime
// chunk is never requested (WC-TW-6c-9c).
// Parent -> iframe messages (ui, connect, ...) need no buffering: the parent queues them until
// __iframeReady, which the runtime fires only after its message listener is installed.
export function loadEmbedIframeRuntimeIfEmbedded(): Promise<void> | null {
  if (!isBrowser || !window.isEmbed?.() || !sdkActionManager) {
    return null;
  }
  startBufferingEventsBeforeRuntime();
  return import("../embed-iframe").then(() => undefined);
}

loadEmbedIframeRuntimeIfEmbedded();
