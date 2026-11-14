import { describe, expect, it } from "vitest";
import { generateOrgKey, hasScope, isPlatformMasterKey, orgKeyMatches, parseOrgKey } from "./keys";
import { ProvisionError, parseProvisionBody, slugify } from "./provision";

describe("org keys", () => {
  it("generates parseable keys that verify and never verify when revoked or altered", () => {
    const k = generateOrgKey();
    expect(parseOrgKey(k.raw)).toEqual({ prefix: k.prefix });
    expect(orgKeyMatches(k.raw, { hashedKey: k.hashedKey, revokedAt: null })).toBe(true);
    expect(orgKeyMatches(k.raw, { hashedKey: k.hashedKey, revokedAt: new Date() })).toBe(false);
    expect(orgKeyMatches(k.raw + "0", { hashedKey: k.hashedKey, revokedAt: null })).toBe(false);
  });
  it("rejects malformed tokens", () => {
    for (const t of ["", "abc", "twk_zz.1", "twk_12345678.short", "twk_12345678"])
      expect(parseOrgKey(t)).toBeNull();
  });
  it("master key needs >= 24 chars and an exact match", () => {
    expect(isPlatformMasterKey("x", { TW_PLATFORM_MASTER_KEY: "x" } as never)).toBe(false);
    expect(isPlatformMasterKey("m".repeat(24), { TW_PLATFORM_MASTER_KEY: "m".repeat(24) } as never)).toBe(
      true
    );
    expect(
      isPlatformMasterKey("m".repeat(23) + "n", { TW_PLATFORM_MASTER_KEY: "m".repeat(24) } as never)
    ).toBe(false);
    expect(isPlatformMasterKey("m".repeat(24), {} as never)).toBe(false);
  });
  it("scopes", () => {
    expect(hasScope(["*"], "a")).toBe(true);
    expect(hasScope(["a"], "b")).toBe(false);
  });
});

describe("provision body", () => {
  const ok = { external_ref: "r1", name: "N", owner: { email: "A@B.co" } };
  it("accepts and normalises", () => {
    expect(parseProvisionBody(ok).owner.email).toBe("a@b.co");
  });
  it.each([
    [null],
    [{}],
    [{ ...ok, external_ref: "" }],
    [{ ...ok, owner: { email: "nope" } }],
    [{ ...ok, slug: "Bad Slug" }],
    [{ ...ok, working_hours: { days: [7], start: "09:00", end: "17:00" } }],
    [{ ...ok, working_hours: { days: [1], start: "18:00", end: "17:00" } }],
    [{ ...ok, owner: { email: "a@b.co", timezone: "Mars/Base" } }],
  ])("rejects %j", (b) => {
    expect(() => parseProvisionBody(b)).toThrow(ProvisionError);
  });
  it("slugify", () => {
    expect(slugify("  Acme Dental!! ")).toBe("acme-dental");
    expect(slugify("###")).toBe("org");
  });
});
