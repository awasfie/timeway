// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

// TW-T14b: boot next-auth-options in both identity modes and read the provider list it assembles.
async function boot(mode: string | undefined) {
  vi.resetModules();
  if (mode === undefined) delete process.env.TW_IDENTITY_MODE;
  else process.env.TW_IDENTITY_MODE = mode;
  const mod = await import("@calcom/features/auth/lib/next-auth-options");
  return mod.getOptions({ getDubId: () => undefined, getTrackingData: () => ({}) as never }).providers.map((p: { id: string; options?: { id?: string } }) => p.options?.id ?? p.id);
}

describe("next-auth-options boot per identity mode", () => {
  afterEach(() => {
    delete process.env.TW_IDENTITY_MODE;
  });
  it("local (default) offers credentials and email, not passport", async () => {
    const ids = await boot(undefined);
    expect(ids).toContain("credentials");
    expect(ids).toContain("email");
    expect(ids).not.toContain("passport");
  });
  it("passport offers only passport", async () => {
    expect(await boot("passport")).toEqual(["passport"]);
  });
  it("bad value fails the boot", async () => {
    await expect(boot("pasport")).rejects.toThrow(/TW_IDENTITY_MODE/);
  });
});
