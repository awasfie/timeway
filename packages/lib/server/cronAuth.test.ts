import process from "node:process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getCronCredentialCandidates, isCronAuthorized, isCronCredentialValid } from "./cronAuth";

const req = (authorization: string | null, query = "") => ({
  headers: { get: (name: string) => (name.toLowerCase() === "authorization" ? authorization : null) },
  url: `http://localhost/api/cron/x${query ? `?${query}` : ""}`,
});

describe("cronAuth", () => {
  beforeEach(() => {
    vi.stubEnv("CRON_API_KEY", "");
    vi.stubEnv("CRON_SECRET", "");
    delete process.env.CRON_API_KEY;
    delete process.env.CRON_SECRET;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("has no candidates when neither env var is set, so nothing is authorized", () => {
    expect(getCronCredentialCandidates()).toEqual([]);
    expect(isCronAuthorized(req("Bearer undefined"))).toBe(false);
    expect(isCronAuthorized(req("undefined"))).toBe(false);
    expect(isCronAuthorized(req("Bearer "))).toBe(false);
    expect(isCronAuthorized(req(""))).toBe(false);
    expect(isCronAuthorized(req(null))).toBe(false);
  });

  it("rejects 'Bearer undefined' and 'Bearer ' when only CRON_API_KEY is set", () => {
    vi.stubEnv("CRON_API_KEY", "k-123");
    expect(getCronCredentialCandidates()).toEqual(["k-123"]);
    expect(isCronAuthorized(req("Bearer undefined"))).toBe(false);
    expect(isCronAuthorized(req("Bearer null"))).toBe(false);
    expect(isCronAuthorized(req("Bearer "))).toBe(false);
    expect(isCronAuthorized(req(null, "apiKey=Bearer%20undefined"))).toBe(false);
  });

  it("treats whitespace-only env values as unset", () => {
    vi.stubEnv("CRON_API_KEY", "   ");
    vi.stubEnv("CRON_SECRET", " ");
    expect(getCronCredentialCandidates()).toEqual([]);
    expect(isCronAuthorized(req("   "))).toBe(false);
    expect(isCronAuthorized(req("Bearer  "))).toBe(false);
  });

  it("accepts CRON_API_KEY from the header or the apiKey query param", () => {
    vi.stubEnv("CRON_API_KEY", "k-123");
    expect(isCronAuthorized(req("k-123"))).toBe(true);
    expect(isCronAuthorized(req(null, "apiKey=k-123"))).toBe(true);
    expect(isCronAuthorized(req("k-1234"))).toBe(false);
    expect(isCronAuthorized(req("k-12"))).toBe(false);
  });

  it("accepts Bearer CRON_SECRET only when CRON_SECRET is set", () => {
    vi.stubEnv("CRON_SECRET", "s-456");
    expect(isCronAuthorized(req("Bearer s-456"))).toBe(true);
    expect(isCronAuthorized(req("s-456"))).toBe(false);
    expect(isCronAuthorized(req("Bearer undefined"))).toBe(false);
  });

  it("honours allowBearerSecret, allowApiKey and allowQueryParam", () => {
    vi.stubEnv("CRON_API_KEY", "k-123");
    vi.stubEnv("CRON_SECRET", "s-456");
    expect(isCronAuthorized(req("Bearer s-456"), { allowBearerSecret: false })).toBe(false);
    expect(isCronAuthorized(req("k-123"), { allowBearerSecret: false })).toBe(true);
    expect(isCronAuthorized(req("k-123"), { allowApiKey: false })).toBe(false);
    expect(isCronAuthorized(req(null, "apiKey=k-123"), { allowQueryParam: false })).toBe(false);
  });

  it("isCronCredentialValid rejects empty and nullish input", () => {
    vi.stubEnv("CRON_API_KEY", "k-123");
    expect(isCronCredentialValid(undefined)).toBe(false);
    expect(isCronCredentialValid(null)).toBe(false);
    expect(isCronCredentialValid("")).toBe(false);
  });
});
