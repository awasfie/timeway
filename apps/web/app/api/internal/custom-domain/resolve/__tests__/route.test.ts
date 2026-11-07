import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { hostname: string; status: "pending_dns" | "active" | "failed"; orgId: string; orgSlug: string };

const state = vi.hoisted(() => ({
  rows: [] as Row[],
  users: [] as { username: string; twOrgId: string | null }[],
}));

// A Prisma stand-in that records every call: the route must only ever read.
const prismaCalls = vi.hoisted(() => [] as string[]);

vi.mock("@calcom/prisma/tw-org-context", () => ({
  withTwPlatform: async (prisma: unknown, _reason: string, fn: (tx: unknown) => Promise<unknown>) =>
    fn(prisma),
  runWithTwPlatform: async (_reason: string, fn: () => Promise<unknown>) => fn(),
}));

vi.mock("@calcom/prisma", () => {
  const model = (name: string, findFirst: (args: never) => unknown, findMany: (args: never) => unknown) =>
    new Proxy(
      { findFirst, findMany },
      {
        get(target, prop: string) {
          prismaCalls.push(`${name}.${prop}`);
          return (target as Record<string, unknown>)[prop];
        },
      }
    );
  return {
    prisma: {
      twCustomHostname: model(
        "twCustomHostname",
        async ({ where }: { where: { hostname: string; status: string } }) => {
          const row = state.rows.find((r) => r.hostname === where.hostname && r.status === where.status);
          return row ? { orgId: row.orgId, org: { slug: row.orgSlug, status: "active" } } : null;
        },
        async () => []
      ),
      user: model(
        "user",
        async () => null,
        async ({ where }: { where: { username: { in: string[] } } }) =>
          state.users.filter((u) => where.username.in.includes(u.username.toLowerCase()))
      ),
      team: model(
        "team",
        async () => null,
        async () => []
      ),
    },
  };
});

const SECRET = "test-approve-secret";
const BASE = "http://localhost/api/internal/custom-domain/resolve";

function req(query: string, headers: Record<string, string> = { "x-tw-domain-approve-secret": SECRET }) {
  return new NextRequest(`${BASE}${query}`, { headers });
}

async function loadGET() {
  vi.resetModules();
  return (await import("../route")).GET;
}

describe("GET /api/internal/custom-domain/resolve", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("TW_CUSTOM_DOMAINS_ENABLED", "true");
    vi.stubEnv("TW_DOMAIN_APPROVE_SECRET", SECRET);
    prismaCalls.length = 0;
    state.rows = [
      { hostname: "book.acme.com", status: "active", orgId: "org_acme", orgSlug: "acme" },
      { hostname: "pending.acme.com", status: "pending_dns", orgId: "org_acme", orgSlug: "acme" },
      { hostname: "failed.acme.com", status: "failed", orgId: "org_acme", orgSlug: "acme" },
    ];
    state.users = [
      { username: "alice", twOrgId: "org_acme" },
      { username: "mallory", twOrgId: "org_globex" },
    ];
  });

  it("returns 404 with the flag off, before checking the secret or the database", async () => {
    vi.stubEnv("TW_CUSTOM_DOMAINS_ENABLED", "false");
    const res = await (await loadGET())(req("?host=book.acme.com"));
    expect(res.status).toBe(404);
    expect(prismaCalls).toEqual([]);
  });

  it("returns 503 when the secret is not configured", async () => {
    vi.stubEnv("TW_DOMAIN_APPROVE_SECRET", "");
    expect((await (await loadGET())(req("?host=book.acme.com"))).status).toBe(503);
    expect(prismaCalls).toEqual([]);
  });

  it("returns 401 without the secret header and 403 with a wrong one", async () => {
    const GET = await loadGET();
    expect((await GET(req("?host=book.acme.com", {}))).status).toBe(401);
    expect(
      (await GET(req("?host=book.acme.com", { "x-tw-domain-approve-secret": `${SECRET}x` }))).status
    ).toBe(403);
    expect(prismaCalls).toEqual([]);
  });

  it("returns 400 without a host", async () => {
    expect((await (await loadGET())(req(""))).status).toBe(400);
  });

  it("returns 200 {orgSlug} no-store for an ACTIVE host", async () => {
    const res = await (await loadGET())(req("?host=Book.Acme.com"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ orgSlug: "acme" });
  });

  it.each([
    "pending.acme.com",
    "failed.acme.com",
    "unknown.example.org",
  ])("returns 404 for %s", async (host) => {
    const res = await (await loadGET())(req(`?host=${host}`));
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("allows the org's own users and refuses a foreign one", async () => {
    const GET = await loadGET();
    expect((await GET(req("?host=book.acme.com&users=alice"))).status).toBe(200);
    expect((await GET(req("?host=book.acme.com&users=mallory"))).status).toBe(404);
    expect((await GET(req("?host=book.acme.com&users=alice,mallory"))).status).toBe(404);
  });

  it("never writes: only findFirst/findMany are touched", async () => {
    const GET = await loadGET();
    await GET(req("?host=book.acme.com&users=alice"));
    await GET(req("?host=pending.acme.com"));
    await GET(req("?host=book.acme.com&team=sales"));
    expect(prismaCalls.length).toBeGreaterThan(0);
    expect(prismaCalls.every((c) => /\.(findFirst|findMany)$/.test(c))).toBe(true);
  });
});
