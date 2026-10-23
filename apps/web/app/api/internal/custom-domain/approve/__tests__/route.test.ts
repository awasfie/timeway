import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type ApprovalRow = { status: "pending_dns" | "active" | "failed"; cnameVerifiedAt: Date | null };

const repo = vi.hoisted(() => ({
  rows: new Map<string, ApprovalRow>(),
  findForApproval: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  deleteByOrg: vi.fn(),
  deleteIfStillStale: vi.fn(),
}));

vi.mock("@calcom/features/customHostnames/repositories/CustomHostnameRepository", () => ({
  CustomHostnameRepository: class {
    findForApproval = repo.findForApproval;
    create = repo.create;
    update = repo.update;
    deleteByOrg = repo.deleteByOrg;
    deleteIfStillStale = repo.deleteIfStillStale;
  },
}));

vi.mock("@calcom/prisma", () => ({ prisma: {} }));

const SECRET = "test-approve-secret";
const URL_BASE = "http://localhost/api/internal/custom-domain/approve";

function req(
  domain: string | null,
  headers: Record<string, string> = { "x-tw-domain-approve-secret": SECRET }
) {
  const url = domain === null ? URL_BASE : `${URL_BASE}?domain=${encodeURIComponent(domain)}`;
  return new NextRequest(url, { headers: { "x-real-ip": "10.0.0.1", ...headers } });
}

async function loadGET() {
  vi.resetModules();
  return (await import("../route")).GET;
}

describe("GET /api/internal/custom-domain/approve", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("TW_CUSTOM_DOMAINS_ENABLED", "true");
    vi.stubEnv("TW_DOMAIN_APPROVE_SECRET", SECRET);
    repo.rows.clear();
    repo.rows.set("book.acme.com", { status: "active", cnameVerifiedAt: new Date() });
    repo.rows.set("pending.acme.com", { status: "pending_dns", cnameVerifiedAt: null });
    repo.rows.set("verified.acme.com", { status: "pending_dns", cnameVerifiedAt: new Date() });
    repo.rows.set("failed.acme.com", { status: "failed", cnameVerifiedAt: null });
    repo.findForApproval.mockImplementation(async (h: string) => repo.rows.get(h) ?? null);
  });

  it("returns 404 when the feature flag is off, without touching the repository", async () => {
    vi.stubEnv("TW_CUSTOM_DOMAINS_ENABLED", "false");
    const res = await (await loadGET())(req("book.acme.com"));
    expect(res.status).toBe(404);
    expect(repo.findForApproval).not.toHaveBeenCalled();
  });

  it("returns 503 when TW_DOMAIN_APPROVE_SECRET is not configured", async () => {
    vi.stubEnv("TW_DOMAIN_APPROVE_SECRET", "");
    const res = await (await loadGET())(req("book.acme.com"));
    expect(res.status).toBe(503);
    expect(repo.findForApproval).not.toHaveBeenCalled();
  });

  it("returns 401 without the secret header", async () => {
    const res = await (await loadGET())(req("book.acme.com", {}));
    expect(res.status).toBe(401);
    expect(repo.findForApproval).not.toHaveBeenCalled();
  });

  it.each([
    "wrong",
    `${SECRET}x`,
    SECRET.slice(0, -1),
    SECRET.toUpperCase(),
  ])("returns 403 for a bad secret (%s)", async (secret) => {
    const res = await (await loadGET())(req("book.acme.com", { "x-tw-domain-approve-secret": secret }));
    expect(res.status).toBe(403);
    expect(repo.findForApproval).not.toHaveBeenCalled();
  });

  it("returns 400 when ?domain= is missing", async () => {
    const res = await (await loadGET())(req(null));
    expect(res.status).toBe(400);
  });

  it("returns 200 for an active hostname, with an empty no-store body", async () => {
    const res = await (await loadGET())(req("book.acme.com"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("");
  });

  it("returns 404 for an unknown hostname", async () => {
    const res = await (await loadGET())(req("nope.example.com"));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("");
  });

  it("approves a pending row only once its CNAME is verified; never a failed row", async () => {
    const GET = await loadGET();
    expect((await GET(req("verified.acme.com"))).status).toBe(200);
    expect((await GET(req("pending.acme.com"))).status).toBe(404);
    expect((await GET(req("failed.acme.com"))).status).toBe(404);
  });

  it.each([
    ["ook.acme.com", 404],
    ["x.book.acme.com", 404],
    ["book.acme.com.evil.io", 404],
    ["acme.com", 404],
    ["book.acme.co", 404],
    ["book.acme.com.", 200],
    ["BOOK.ACME.COM", 200],
    ["Book.Acme.Com", 200],
    ["  book.acme.com  ", 200],
  ])("exact match only: %s -> %i", async (domain, expected) => {
    const res = await (await loadGET())(req(domain));
    expect(res.status).toBe(expected);
  });

  it("queries the repository with the lowercased host only (no wildcard, no listing)", async () => {
    await (await loadGET())(req("BOOK.Acme.com"));
    expect(repo.findForApproval).toHaveBeenCalledTimes(1);
    expect(repo.findForApproval).toHaveBeenCalledWith("book.acme.com");
  });

  it("rejects over-long hostnames without a lookup", async () => {
    const long = `${"a".repeat(63)}.`.repeat(4) + "acme.com";
    const res = await (await loadGET())(req(long));
    expect(res.status).toBe(404);
    expect(repo.findForApproval).not.toHaveBeenCalled();
  });

  it("returns 429 after 600 requests per minute from one caller, also for wrong secrets", async () => {
    const GET = await loadGET();
    const bad = { "x-tw-domain-approve-secret": "wrong", "x-real-ip": "10.9.9.9" };
    for (let i = 0; i < 600; i++) expect((await GET(req("book.acme.com", bad))).status).toBe(403);
    expect((await GET(req("book.acme.com", bad))).status).toBe(429);
    const good = { "x-tw-domain-approve-secret": SECRET, "x-real-ip": "10.9.9.9" };
    expect((await GET(req("book.acme.com", good))).status).toBe(429);
    const other = { "x-tw-domain-approve-secret": SECRET, "x-real-ip": "10.0.0.2" };
    expect((await GET(req("book.acme.com", other))).status).toBe(200);
  });

  it("keys the limiter on the proxy-set hop, not a spoofable first x-forwarded-for entry", async () => {
    const GET = await loadGET();
    for (let i = 0; i < 600; i++) {
      await GET(
        new NextRequest(`${URL_BASE}?domain=book.acme.com`, {
          headers: { "x-tw-domain-approve-secret": SECRET, "x-forwarded-for": `1.1.1.${i % 250}, 10.5.5.5` },
        })
      );
    }
    const res = await GET(
      new NextRequest(`${URL_BASE}?domain=book.acme.com`, {
        headers: { "x-tw-domain-approve-secret": SECRET, "x-forwarded-for": "8.8.8.8, 10.5.5.5" },
      })
    );
    expect(res.status).toBe(429);
  });

  it("never writes to the database", async () => {
    const GET = await loadGET();
    for (const d of ["book.acme.com", "pending.acme.com", "verified.acme.com", "nope.example.com"]) {
      await GET(req(d));
    }
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.deleteByOrg).not.toHaveBeenCalled();
    expect(repo.deleteIfStillStale).not.toHaveBeenCalled();
  });

  it("answers well under 200 ms per request with the repository mocked", async () => {
    const GET = await loadGET();
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) await GET(req("book.acme.com"));
    expect((performance.now() - t0) / 50).toBeLessThan(200);
  });
});
