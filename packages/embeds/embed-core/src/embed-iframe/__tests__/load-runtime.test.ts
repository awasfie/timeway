import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeCurrentDocumentUrl } from "./test-utils";

describe("embed-iframe/load-runtime", () => {
  const originalName = window.name;
  let postMessage: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    window.name = "";
    // @ts-expect-error reset what embed-iframe-init defines so each test runs it afresh
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

    expect(window.isEmbed()).toBe(false);
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
});
