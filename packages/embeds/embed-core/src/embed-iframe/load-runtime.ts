import { sdkActionManager } from "../sdk-event";
import { isBrowser } from "./lib/utils";

// The iframe<->parent runtime (../embed-iframe.ts, ~10 KB gz) is only needed inside an embed. Importing
// sdk-event has run embed-iframe-init, so window.isEmbed() is defined here; outside an embed the runtime
// chunk is never requested (WC-TW-6c-9c).
export function loadEmbedIframeRuntimeIfEmbedded(): Promise<void> | null {
  if (!isBrowser || !window.isEmbed?.() || !sdkActionManager) {
    return null;
  }
  const manager = sdkActionManager;
  const firedBeforeLoad: CustomEvent["detail"][] = [];
  const buffer = (e: CustomEvent) => firedBeforeLoad.push(e.detail);
  manager.on("*", buffer);
  return import("../embed-iframe").then(({ forwardEventsFiredBeforeLoad }) => {
    manager.off("*", buffer);
    forwardEventsFiredBeforeLoad(firedBeforeLoad);
  });
}

loadEmbedIframeRuntimeIfEmbedded();
