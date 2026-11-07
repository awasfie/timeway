import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeCurrentDocumentUrl } from "./test-utils";

// WC-TW-6n-1b: the embed runtime loads only in embed mode, and SDK events fired before it arrives still reach the parent.
describe("embed-iframe/loader", () => {
  let runtimeImported = false;

  beforeEach(() => {
    vi.resetModules();
    runtimeImported = false;
    vi.doMock("../runtime", () => {
      runtimeImported = true;
      return {};
    });
    // reset between tests (embed-iframe-init sets it once per page)
    delete window.isEmbed;
    window.name = "";
    Object.defineProperty(window, "top", { value: window, writable: true, configurable: true });
  });

  afterEach(() => {
    vi.doUnmock("../runtime");
    vi.resetModules();
  });

  it("does not load the runtime on a normal top-level page", async () => {
    fakeCurrentDocumentUrl({ params: {} });
    const { shouldLoadEmbedRuntime } = await import("../loader");
    expect(shouldLoadEmbedRuntime()).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(runtimeImported).toBe(false);
  });

  it("loads the runtime when ?embed= is present", async () => {
    fakeCurrentDocumentUrl({ params: { embed: "" } });
    const { shouldLoadEmbedRuntime } = await import("../loader");
    expect(shouldLoadEmbedRuntime()).toBe(true);
    await vi.waitFor(() => expect(runtimeImported).toBe(true));
  });

  it("loads the runtime when window.name carries the embed namespace", async () => {
    fakeCurrentDocumentUrl({ params: {} });
    window.name = "cal-embed=ns1";
    const { shouldLoadEmbedRuntime } = await import("../loader");
    expect(shouldLoadEmbedRuntime()).toBe(true);
    await vi.waitFor(() => expect(runtimeImported).toBe(true));
  });

  it("loads the runtime inside any iframe", async () => {
    fakeCurrentDocumentUrl({ params: {} });
    Object.defineProperty(window, "top", { value: {}, writable: true, configurable: true });
    const { shouldLoadEmbedRuntime } = await import("../loader");
    expect(shouldLoadEmbedRuntime()).toBe(true);
    await vi.waitFor(() => expect(runtimeImported).toBe(true));
  });
});

describe("embed-iframe/lib/eventBuffer", () => {
  beforeEach(() => {
    vi.resetModules();
    fakeCurrentDocumentUrl({ params: { embed: "" } });
  });

  it("captures events fired before the runtime and returns them in order once", async () => {
    const { sdkActionManager } = await import("../../sdk-event");
    const { startBufferingEvents, drainBufferedEvents } = await import("../lib/eventBuffer");
    startBufferingEvents();
    sdkActionManager?.fire("__dimensionChanged", { iframeHeight: 10, iframeWidth: 20, isFirstTime: true });
    sdkActionManager?.fire("linkReady", {});
    const events = drainBufferedEvents();
    expect(events.map((e) => e.type)).toEqual(["__dimensionChanged", "linkReady"]);
    sdkActionManager?.fire("linkReady", {});
    expect(drainBufferedEvents()).toEqual([]);
  });
});
