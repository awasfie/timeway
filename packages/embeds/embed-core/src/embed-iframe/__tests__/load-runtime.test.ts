import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeCurrentDocumentUrl } from "./test-utils";

describe("embed-iframe/load-runtime", () => {
  const originalName = window.name;
  let postMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    window.name = "";
    // Reset what embed-iframe-init defines so each test runs it afresh.
    delete window.isEmbed;
    postMessage = vi.fn();
    Object.defineProperty(window, "top", { value: {}, writable: true, configurable: true });
    Object.defineProperty(window, "parent", { value: { postMessage }, writable: true, configurable: true });
  });

  afterEach(() => {
    window.name = originalName;
    vi.restoreAllMocks();
  });

  it("does not load the runtime outside an embed", async () => {
    fakeCurrentDocumentUrl({ path: "/pro/30min" });
    const { loadEmbedIframeRuntimeIfEmbedded } = await import("../load-runtime");

    expect(window.isEmbed?.()).toBe(false);
    expect(loadEmbedIframeRuntimeIfEmbedded()).toBeNull();
  });

  it("loads the runtime inside an embed and forwards events fired before it loaded", async () => {
    fakeCurrentDocumentUrl({ path: "/pro/30min/embed", params: { embed: "ns1" } });
    const { loadEmbedIframeRuntimeIfEmbedded } = await import("../load-runtime");
    const { sdkActionManager } = await import("../../sdk-event");

    const loading = loadEmbedIframeRuntimeIfEmbedded();
    expect(loading).not.toBeNull();
    sdkActionManager?.fire("eventTypeSelected", { eventType: { id: 1 } });
    await loading;

    const forwardedTypes = postMessage.mock.calls.map(([data]) => data.type);
    expect(forwardedTypes.filter((t) => t === "eventTypeSelected")).toHaveLength(1);

    postMessage.mockClear();
    sdkActionManager?.fire("eventTypeSelected", { eventType: { id: 2 } });
    expect(postMessage.mock.calls.map(([data]) => data.type)).toEqual(["eventTypeSelected"]);
  });

  it("gives components mounted before the runtime loaded the URL ui config", async () => {
    fakeCurrentDocumentUrl({
      path: "/pro/30min/embed",
      params: { embed: "ns1", layout: "week_view", "ui.color-scheme": "dark" },
    });
    const { loadEmbedIframeRuntimeIfEmbedded } = await import("../load-runtime");
    const { embedStore } = await import("../lib/embedStore");
    const earlySetter = vi.fn();
    embedStore.setUiConfig.push(earlySetter);

    await loadEmbedIframeRuntimeIfEmbedded();

    expect(earlySetter).toHaveBeenCalledWith(
      expect.objectContaining({ layout: "week_view", colorScheme: "dark" })
    );
  });

  it("applies a parent ui message that the parent queued until __iframeReady", async () => {
    fakeCurrentDocumentUrl({ path: "/pro/30min/embed", params: { embed: "ns1" } });
    const { loadEmbedIframeRuntimeIfEmbedded } = await import("../load-runtime");
    const { embedStore } = await import("../lib/embedStore");
    const earlySetter = vi.fn();
    embedStore.setUiConfig.push(earlySetter);

    await loadEmbedIframeRuntimeIfEmbedded();
    // embed.ts holds doInIframe() calls in iframeDoQueue until it sees __iframeReady, which main()
    // fires only after its message listener is installed.
    expect(postMessage.mock.calls.map(([data]) => data.type)).toContain("__iframeReady");

    window.dispatchEvent(
      new MessageEvent("message", {
        data: { originator: "CAL", method: "ui", arg: { hideEventTypeDetails: true } },
      })
    );

    expect(earlySetter).toHaveBeenLastCalledWith(expect.objectContaining({ hideEventTypeDetails: true }));
    expect(embedStore.uiConfig).toEqual(expect.objectContaining({ hideEventTypeDetails: true }));
  });
});
