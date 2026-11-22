// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

// TW-T14b: boot next-auth-options in both identity modes and read the provider list it assembles.
async function boot(mode: string | undefined, env: Record<string, string> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) process.env[k] = v;
  if (mode === undefined) delete process.env.TW_IDENTITY_MODE;
  else process.env.TW_IDENTITY_MODE = mode;
  const mod = await import("@calcom/features/auth/lib/next-auth-options");
  return mod
    .getOptions({ getDubId: () => undefined, getTrackingData: () => ({}) as never })
    .providers.map((p: { id: string; options?: { id?: string } }) => p.options?.id ?? p.id);
}

describe("next-auth-options boot per identity mode", () => {
  afterEach(() => {
    for (const k of [
      "TW_IDENTITY_MODE",
      "PASSPORT_BASE_URL",
      "STRIPE_PRIVATE_KEY",
      "OUTLOOK_LOGIN_ENABLED",
      "MS_GRAPH_CLIENT_ID",
      "MS_GRAPH_CLIENT_SECRET",
    ])
      delete process.env[k];
  });
  it("local (default) offers credentials and email, not passport", async () => {
    const ids = await boot(undefined);
    expect(ids).toContain("credentials");
    expect(ids).toContain("email");
    expect(ids).not.toContain("passport");
  });
  it("passport offers only passport", async () => {
    expect(await boot("passport", { PASSPORT_BASE_URL: "https://passport.example" })).toEqual(["passport"]);
  });
  it("passport stays passport-only with the Outlook login env set", async () => {
    const ids = await boot("passport", {
      PASSPORT_BASE_URL: "https://passport.example",
      OUTLOOK_LOGIN_ENABLED: "true",
      MS_GRAPH_CLIENT_ID: "cid",
      MS_GRAPH_CLIENT_SECRET: "secret",
    });
    expect(ids).toEqual(["passport"]);
  });
  it("local with the Outlook login env set still offers azure-ad", async () => {
    const ids = await boot("local", {
      OUTLOOK_LOGIN_ENABLED: "true",
      MS_GRAPH_CLIENT_ID: "cid",
      MS_GRAPH_CLIENT_SECRET: "secret",
    });
    expect(ids).toContain("azure-ad");
  });
  it("passport without PASSPORT_BASE_URL fails the boot", async () => {
    await expect(boot("passport")).rejects.toThrow(/PASSPORT_BASE_URL/);
  });
  it("passport with a STRIPE* variable fails the boot", async () => {
    await expect(
      boot("passport", { PASSPORT_BASE_URL: "https://passport.example", STRIPE_PRIVATE_KEY: "sk_test_x" })
    ).rejects.toThrow(/STRIPE/);
  });
  it("bad value fails the boot", async () => {
    await expect(boot("pasport")).rejects.toThrow(/TW_IDENTITY_MODE/);
  });
});
