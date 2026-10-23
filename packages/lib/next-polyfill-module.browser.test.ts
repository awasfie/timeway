import { afterEach, describe, expect, it, vi } from "vitest";

const urlCtor = URL as typeof URL & { canParse?: (url: string | URL, base?: string | URL) => boolean };
const native = Object.getOwnPropertyDescriptor(URL, "canParse");

describe("next-polyfill-module.browser", () => {
  afterEach(() => {
    if (native) Object.defineProperty(URL, "canParse", native);
    vi.resetModules();
  });

  it("keeps a native URL.canParse untouched", async () => {
    const before = urlCtor.canParse;
    await import("./next-polyfill-module.browser");
    expect(urlCtor.canParse).toBe(before);
  });

  it("adds URL.canParse on engines without it (Safari 16.4, Firefox 111)", async () => {
    Reflect.deleteProperty(URL, "canParse");
    expect("canParse" in URL).toBe(false);
    await import("./next-polyfill-module.browser");
    expect(urlCtor.canParse?.("https://timeway.co/pro/30min")).toBe(true);
    expect(urlCtor.canParse?.("/pro/30min", "https://timeway.co")).toBe(true);
    expect(urlCtor.canParse?.("not a url")).toBe(false);
  });
});
