"use client";
/**
 * WC-TW-6n-1b: page wrappers import this instead of the whole embed-iframe module. It decides at load time whether
 * the page is (or may be) an embed and only then fetches the embed runtime (parent postMessage bridge, ~15 KB gz),
 * so a normal booking page never downloads it.
 *
 * Embed mode = what embed-iframe-init detects (`?embed=`, `window.name` "cal-embed=", a path ending in /embed; the
 * same path the proxy marks with x-isEmbed), plus any page running inside an iframe or carrying `ui.color-scheme`,
 * which the runtime acted on before this split.
 */
import embedInit from "../../embed-iframe-init";
import { startBufferingEvents } from "./lib/eventBuffer";

export function shouldLoadEmbedRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  if (window.isEmbed?.()) {
    return true;
  }
  let inIframe = true;
  try {
    inIframe = window.top !== window;
  } catch {
    // Cross-origin access to top can throw in some browsers; that only happens inside a frame.
  }
  if (inIframe) {
    return true;
  }
  return new URL(document.URL).searchParams.has("ui.color-scheme");
}

let runtimePromise: Promise<unknown> | null = null;

export function loadEmbedRuntime() {
  if (!runtimePromise) {
    startBufferingEvents();
    runtimePromise = import("./runtime");
  }
  return runtimePromise;
}

if (typeof window !== "undefined") {
  embedInit();
  if (shouldLoadEmbedRuntime()) {
    void loadEmbedRuntime();
  }
}
