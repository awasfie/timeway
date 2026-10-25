import { FakeCustomHostnameRepository } from "@calcom/lib/domainManager/customHostnames/__tests__/fakeStore";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ current: null as unknown }));

vi.mock("@calcom/features/customHostnames/repositories/CustomHostnameRepository", () => ({
  CustomHostnameRepository: class {
    constructor() {
      // biome-ignore lint/correctness/noConstructorReturn: hand the route the shared in-memory store
      return store.current as object;
    }
  },
}));

vi.mock("@calcom/prisma", () => ({ prisma: {} }));

const HOUR = 60 * 60 * 1000;
const URL_BASE = "http://localhost/api/cron/custom-hostnames-cleanup";
const ctx = { params: Promise.resolve({}) };

function seedStore() {
  const repo = new FakeCustomHostnameRepository();
  const now = Date.now();
  repo.seed({ orgId: "o1", hostname: "old-pending.acme.com", createdAt: new Date(now - 49 * HOUR) });
  repo.seed({
    orgId: "o2",
    hostname: "old-failed.acme.com",
    status: "failed",
    createdAt: new Date(now - 72 * HOUR),
  });
  repo.seed({
    orgId: "o3",
    hostname: "old-active.acme.com",
    status: "active",
    activatedAt: new Date(now - 40 * HOUR),
    createdAt: new Date(now - 72 * HOUR),
  });
  repo.seed({ orgId: "o4", hostname: "young.acme.com", createdAt: new Date(now - 47 * HOUR) });
  store.current = repo;
  return repo;
}

async function call(url: string, headers: Record<string, string> = { authorization: "test-cron-key" }) {
  vi.resetModules();
  const { GET } = await import("../route");
  return GET(new NextRequest(url, { headers }), ctx);
}

describe("GET /api/cron/custom-hostnames-cleanup", () => {
  let repo: FakeCustomHostnameRepository;

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("CRON_API_KEY", "test-cron-key");
    vi.stubEnv("CRON_SECRET", "test-cron-secret");
    repo = seedStore();
  });

  it("returns 403 without credentials and deletes nothing", async () => {
    const res = await call(`${URL_BASE}?dryRun=false`, {});
    expect(res.status).toBe(403);
    expect(repo.rows.size).toBe(4);
    expect(repo.deleteCalls).toEqual([]);
  });

  it("returns 403 for a wrong key", async () => {
    const res = await call(`${URL_BASE}?dryRun=false`, { authorization: "nope" });
    expect(res.status).toBe(403);
    expect(repo.rows.size).toBe(4);
  });

  it("returns 403 when CRON_API_KEY is unset and no header is sent", async () => {
    vi.stubEnv("CRON_API_KEY", "");
    vi.stubEnv("CRON_SECRET", "");
    const res = await call(`${URL_BASE}?dryRun=false`, {});
    expect(res.status).toBe(403);
    expect(repo.rows.size).toBe(4);
  });

  it.each([
    "Bearer undefined",
    "Bearer ",
    "undefined",
    "null",
  ])("with CRON_SECRET and CRON_API_KEY unset, rejects %j", async (authorization) => {
    vi.stubEnv("CRON_API_KEY", undefined);
    vi.stubEnv("CRON_SECRET", undefined);
    const res = await call(`${URL_BASE}?dryRun=false`, { authorization });
    expect(res.status).toBe(403);
    expect(repo.rows.size).toBe(4);
  });

  it("accepts Bearer CRON_SECRET (Vercel cron) and the apiKey query param", async () => {
    expect((await call(URL_BASE, { authorization: "Bearer test-cron-secret" })).status).toBe(200);
    expect((await call(`${URL_BASE}?apiKey=test-cron-key`, {})).status).toBe(200);
  });

  it("defaults to dry-run: reports candidates, deletes nothing", async () => {
    const res = await call(URL_BASE);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      ok: true,
      dryRun: true,
      candidates: 2,
      deleted: 0,
      hostnames: ["old-failed.acme.com", "old-pending.acme.com"],
    });
    expect(repo.rows.size).toBe(4);
    expect(repo.deleteCalls).toEqual([]);
  });

  it.each([
    "true",
    "0",
    "no",
    "FALSE",
    "",
  ])("any dryRun value other than 'false' stays dry (%s)", async (v) => {
    const body = await (await call(`${URL_BASE}?dryRun=${v}`)).json();
    expect(body.dryRun).toBe(true);
    expect(repo.rows.size).toBe(4);
  });

  it("dryRun=false deletes only never-activated rows older than 48 h, one at a time", async () => {
    const body = await (await call(`${URL_BASE}?dryRun=false`)).json();
    expect(body).toMatchObject({ ok: true, dryRun: false, candidates: 2, deleted: 2 });
    expect(repo.deleteCalls).toHaveLength(2);
    expect(
      Array.from(repo.rows.values())
        .map((r) => r.hostname)
        .sort()
    ).toEqual(["old-active.acme.com", "young.acme.com"]);
  });

  it("returns 500 with the error message when the repository fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    repo.listNeverActivatedBefore = async () => {
      throw new Error("db down");
    };
    const res = await call(URL_BASE);
    expect(res.status).toBe(500);
    expect((await res.json()).message).toBe("db down");
    spy.mockRestore();
  });
});
