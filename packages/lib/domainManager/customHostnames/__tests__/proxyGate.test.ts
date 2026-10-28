import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Resolver } from "../proxyGate";
import { clearCustomHostCache, createHttpResolver, decideCustomHost, readGateEnv } from "../proxyGate";
import { RESOLVE_CACHE_TTL_MS } from "../resolve";
import { APPROVE_SECRET_HEADER } from "../service";

const ON = { enabled: true, ownHosts: ["app.example.com"] };
const OFF = { enabled: false, ownHosts: ["app.example.com"] };

/** Mirrors resolveCustomHost: book.acme.com is ACTIVE for org acme; alice + team sales are acme's. */
const resolver = vi.fn<Resolver>(async (q) => {
  if (q.host !== "book.acme.com") return null;
  if (q.users && !q.users.every((u) => u === "alice")) return null;
  if (q.team && q.team !== "sales") return null;
  return { orgSlug: "acme" };
});

const decide = (hostHeader: string | null, path: string, env = ON, search = "") =>
  decideCustomHost({ hostHeader, pathname: path, search }, env, resolver);

describe("decideCustomHost", () => {
  beforeEach(() => {
    vi.mocked(resolver).mockClear();
  });

  it.each([
    "timeway.co",
    "acme.timeway.co",
    "app.example.com:443",
    "localhost:3000",
    "127.0.0.1",
    null,
  ])("platform host %s passes through with the flag on or off", async (host) => {
    expect(await decide(host, "/alice")).toEqual({ action: "next" });
    expect(await decide(host, "/alice", OFF)).toEqual({ action: "next" });
    expect(resolver).not.toHaveBeenCalled();
  });

  it("flag off: a customer host 404s without a lookup", async () => {
    expect(await decide("book.acme.com", "/", OFF)).toEqual({ action: "notFound" });
    expect(resolver).not.toHaveBeenCalled();
  });

  it("active host: / rewrites to the org booking page, keeping the query", async () => {
    expect(await decide("book.acme.com", "/", ON, "?month=2026-11")).toEqual({
      action: "rewrite",
      pathname: "/team/acme",
      search: "?month=2026-11&isOrgProfile=1",
    });
    expect(await decide("Book.Acme.com:443", "/embed")).toEqual({
      action: "rewrite",
      pathname: "/team/acme/embed",
      search: "?isOrgProfile=1",
    });
  });

  it("active host: own user and team pages are served", async () => {
    expect(await decide("book.acme.com", "/alice/30min")).toEqual({ action: "serve" });
    expect(await decide("book.acme.com", "/team/sales")).toEqual({ action: "serve" });
    expect(resolver).toHaveBeenCalledWith({ host: "book.acme.com", users: ["alice"] });
    expect(resolver).toHaveBeenCalledWith({ host: "book.acme.com", team: "sales" });
  });

  it("active host: another org's user or team slug 404s", async () => {
    expect(await decide("book.acme.com", "/mallory")).toEqual({ action: "notFound" });
    expect(await decide("book.acme.com", "/alice+mallory")).toEqual({ action: "notFound" });
    expect(await decide("book.acme.com", "/team/rivals")).toEqual({ action: "notFound" });
  });

  it("pending, failed and unknown hosts 404 (resolver returns null for any non-active row)", async () => {
    for (const host of ["pending.acme.com", "failed.acme.com", "unknown.example.com"]) {
      expect(await decide(host, "/")).toEqual({ action: "notFound" });
    }
  });

  it("denied paths 404 without a lookup", async () => {
    expect(await decide("book.acme.com", "/settings/my-account")).toEqual({ action: "notFound" });
    expect(await decide("book.acme.com", "/api/internal/custom-domain/resolve")).toEqual({
      action: "notFound",
    });
    expect(resolver).not.toHaveBeenCalled();
  });

  it("passthrough paths are served only on an active host", async () => {
    expect(await decide("book.acme.com", "/booking/abc")).toEqual({ action: "serve" });
    expect(await decide("unknown.example.com", "/booking/abc")).toEqual({ action: "notFound" });
  });
});

describe("readGateEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults the flag to false and collects own hosts", () => {
    vi.stubEnv("TW_CUSTOM_DOMAINS_ENABLED", "");
    vi.stubEnv("NEXT_PUBLIC_WEBAPP_URL", "https://app.example.com");
    vi.stubEnv("ALLOWED_HOSTNAMES", '"one.example.com","two.example.com:3000"');
    const env = readGateEnv();
    expect(env.enabled).toBe(false);
    expect(env.ownHosts).toEqual(
      expect.arrayContaining(["app.example.com", "one.example.com", "two.example.com"])
    );
  });

  it("enables only on the exact string true", () => {
    vi.stubEnv("TW_CUSTOM_DOMAINS_ENABLED", "1");
    expect(readGateEnv().enabled).toBe(false);
    vi.stubEnv("TW_CUSTOM_DOMAINS_ENABLED", "true");
    expect(readGateEnv().enabled).toBe(true);
  });
});

describe("createHttpResolver", () => {
  beforeEach(() => {
    clearCustomHostCache();
    vi.stubEnv("TW_DOMAIN_APPROVE_SECRET", "s3cret");
    vi.stubEnv("TW_INTERNAL_APP_URL", "http://internal:3000");
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  const json = (status: number, body?: unknown) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status });

  it("calls the internal route with the secret header and query", async () => {
    const fetchImpl = vi.fn(async () => json(200, { orgSlug: "acme" }));
    const resolve = createHttpResolver(fetchImpl as unknown as typeof fetch);
    expect(await resolve({ host: "book.acme.com", users: ["alice", "bob"], team: "sales" })).toEqual({
      orgSlug: "acme",
    });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe(
      "http://internal:3000/api/internal/custom-domain/resolve?host=book.acme.com&users=alice%2Cbob&team=sales"
    );
    expect((init.headers as Record<string, string>)[APPROVE_SECRET_HEADER]).toBe("s3cret");
  });

  it("caches a positive answer for 60 s", async () => {
    const fetchImpl = vi.fn(async () => json(200, { orgSlug: "acme" }));
    const resolve = createHttpResolver(fetchImpl as unknown as typeof fetch);
    await resolve({ host: "book.acme.com" });
    vi.advanceTimersByTime(RESOLVE_CACHE_TTL_MS - 1);
    await resolve({ host: "book.acme.com" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await resolve({ host: "book.acme.com" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("caches a 404 (negative) for 60 s", async () => {
    const fetchImpl = vi.fn(async () => json(404));
    const resolve = createHttpResolver(fetchImpl as unknown as typeof fetch);
    expect(await resolve({ host: "unknown.example.com" })).toBeNull();
    vi.advanceTimersByTime(RESOLVE_CACHE_TTL_MS - 1);
    expect(await resolve({ host: "unknown.example.com" })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    await resolve({ host: "unknown.example.com" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keys the cache by host, users and team", async () => {
    const fetchImpl = vi.fn(async () => json(200, { orgSlug: "acme" }));
    const resolve = createHttpResolver(fetchImpl as unknown as typeof fetch);
    await resolve({ host: "book.acme.com" });
    await resolve({ host: "book.acme.com", users: ["alice"] });
    await resolve({ host: "book.acme.com", team: "sales" });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("fails closed and does not cache transport errors, 5xx or bad bodies", async () => {
    for (const impl of [
      async () => {
        throw new Error("ECONNREFUSED");
      },
      async () => json(503),
      async () => json(200, { nope: 1 }),
    ]) {
      clearCustomHostCache();
      const fetchImpl = vi.fn(impl);
      const resolve = createHttpResolver(fetchImpl as unknown as typeof fetch);
      expect(await resolve({ host: "book.acme.com" })).toBeNull();
      expect(await resolve({ host: "book.acme.com" })).toBeNull();
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    }
  });

  it("fails closed without a secret and makes no request", async () => {
    vi.stubEnv("TW_DOMAIN_APPROVE_SECRET", "");
    const fetchImpl = vi.fn();
    const resolve = createHttpResolver(fetchImpl as unknown as typeof fetch);
    expect(await resolve({ host: "book.acme.com" })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
