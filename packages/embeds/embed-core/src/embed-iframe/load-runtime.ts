import "../sdk-event";
import { isBrowser } from "./lib/utils";

// The iframe<->parent runtime (../embed-iframe.ts, ~10 KB gz) is only needed inside an embed. sdk-event
// has already run embed-iframe-init, so window.isEmbed() is defined here; outside an embed the runtime
// chunk is never requested (WC-TW-6c-9c).
export function loadEmbedIframeRuntimeIfEmbedded(): Promise<unknown> | null {
  if (!isBrowser || !window.isEmbed?.()) {
    return null;
  }
  return import("../embed-iframe");
}

loadEmbedIframeRuntimeIfEmbedded();
