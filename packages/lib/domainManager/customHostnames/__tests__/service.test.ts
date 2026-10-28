import { ErrorWithCode } from "@calcom/lib/errors";
import { describe, expect, it, vi } from "vitest";
import type { HttpsProbeResult } from "../probes";
import {
  CustomHostnameService,
  cleanupStaleHostnames,
  DEFAULT_CNAME_TARGET,
  isHostnameApproved,
  STALE_AFTER_MS,
} from "../service";
import { FakeCustomHostnameRepository } from "./fakeStore";

const NOW = new Date("2026-10-20T10:00:00.000Z");
const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const HOST = "book.acme.com";

function setup(opts: { cname?: string[] | Error; probe?: HttpsProbeResult } = {}) {
  const repo = new FakeCustomHostnameRepository(() => NOW);
  const lookupCname = vi.fn(async () => {
    if (opts.cname instanceof Error) throw opts.cname;
    return opts.cname ?? [];
  });
  const probeHttps = vi.fn(async () => opts.probe ?? ({ ok: false, error: "ECONNREFUSED" } as const));
  const service = new CustomHostnameService({
    repository: repo,
    lookupCname,
    probeHttps,
    cnameTarget: DEFAULT_CNAME_TARGET,
    now: () => NOW,
  });
  return { repo, lookupCname, probeHttps, service };
}

async function rejection(p: Promise<unknown>) {
  const err = await p.then(
    () => null,
    (e: unknown) => e
  );
  expect(err).toBeInstanceOf(ErrorWithCode);
  return (err as ErrorWithCode).data?.reason;
}

describe("CustomHostnameService.addHostname", () => {
  it("stores the normalized hostname as pending_dns", async () => {
    const { service } = setup();
    const row = await service.addHostname(ORG, "Book.Acme.Com.");
    expect(row).toMatchObject({ orgId: ORG, hostname: HOST, status: "pending_dns", sslStatus: "none" });
  });

  it.each([
    ["acme.com", "apex_not_allowed"],
    ["*.timeway.co", "wildcard"],
    ["book.timeway.co", "reserved_domain"],
    ["10.0.0.1", "ip_address"],
  ])("rejects %j with %s and writes nothing", async (input, reason) => {
    const { service, repo } = setup();
    expect(await rejection(service.addHostname(ORG, input))).toBe(reason);
    expect(repo.rows.size).toBe(0);
  });

  it("allows one hostname per org", async () => {
    const { service, repo } = setup();
    await service.addHostname(ORG, HOST);
    expect(await rejection(service.addHostname(ORG, "other.acme.com"))).toBe("one_per_org");
    expect(repo.rows.size).toBe(1);
  });

  it("refuses a hostname another org already holds", async () => {
    const { service } = setup();
    await service.addHostname(OTHER_ORG, HOST);
    expect(await rejection(service.addHostname(ORG, "BOOK.acme.com."))).toBe("hostname_taken");
  });

  it("allows a new hostname after remove", async () => {
    const { service } = setup();
    await service.addHostname(ORG, HOST);
    expect(await service.remove(ORG)).toBe(true);
    expect(await service.remove(ORG)).toBe(false);
    await expect(service.addHostname(ORG, "other.acme.com")).resolves.toMatchObject({
      status: "pending_dns",
    });
  });
});

describe("CustomHostnameService.refresh", () => {
  it("returns null when the org has no hostname", async () => {
    const { service, lookupCname } = setup();
    expect(await service.refresh(ORG)).toBeNull();
    expect(lookupCname).not.toHaveBeenCalled();
  });

  it("pending_dns without a CNAME stays pending, no probe", async () => {
    const { service, repo, probeHttps } = setup({ cname: [] });
    repo.seed({ orgId: ORG, hostname: HOST });
    const row = await service.refresh(ORG);
    expect(row).toMatchObject({
      status: "pending_dns",
      sslStatus: "none",
      cnameVerifiedAt: null,
      lastCheckedAt: NOW,
      lastError: "cname_missing",
    });
    expect(probeHttps).not.toHaveBeenCalled();
    expect(await isHostnameApproved(repo, HOST)).toBe(false);
  });

  it("pending_dns with a CNAME to the wrong target stays pending with the mismatch recorded", async () => {
    const { service, repo } = setup({ cname: ["elsewhere.example.net"] });
    repo.seed({ orgId: ORG, hostname: HOST });
    expect(await service.refresh(ORG)).toMatchObject({
      status: "pending_dns",
      lastError: "cname_mismatch: points to elsewhere.example.net",
    });
  });

  it("pending_dns -> active when CNAME matches (case and trailing dot ignored) and HTTPS probe succeeds", async () => {
    const { service, repo, probeHttps } = setup({ cname: ["Customers.Timeway.co."], probe: { ok: true } });
    repo.seed({ orgId: ORG, hostname: HOST });
    const row = await service.refresh(ORG);
    expect(probeHttps).toHaveBeenCalledWith(HOST);
    expect(row).toMatchObject({
      status: "active",
      sslStatus: "issued",
      cnameVerifiedAt: NOW,
      activatedAt: NOW,
      lastCheckedAt: NOW,
      lastError: null,
    });
    expect(await isHostnameApproved(repo, HOST)).toBe(true);
  });

  it("CNAME ok but cert not yet issued: pending with cnameVerifiedAt, approval opens", async () => {
    const { service, repo } = setup({
      cname: [DEFAULT_CNAME_TARGET],
      probe: { ok: false, error: "CERT_HAS_EXPIRED" },
    });
    repo.seed({ orgId: ORG, hostname: HOST });
    expect(await service.refresh(ORG)).toMatchObject({
      status: "pending_dns",
      sslStatus: "pending",
      cnameVerifiedAt: NOW,
      activatedAt: null,
      lastError: "https_probe: CERT_HAS_EXPIRED",
    });
    expect(await isHostnameApproved(repo, HOST)).toBe(true);
  });

  it("active -> failed with lastError when the CNAME disappears; approval closes", async () => {
    const earlier = new Date(NOW.getTime() - 86_400_000);
    const { service, repo } = setup({ cname: [] });
    repo.seed({
      orgId: ORG,
      hostname: HOST,
      status: "active",
      sslStatus: "issued",
      cnameVerifiedAt: earlier,
      activatedAt: earlier,
    });
    expect(await service.refresh(ORG)).toMatchObject({
      status: "failed",
      sslStatus: "issued",
      cnameVerifiedAt: null,
      activatedAt: earlier,
      lastError: "cname_missing",
    });
    expect(await isHostnameApproved(repo, HOST)).toBe(false);
  });

  it("failed stays failed while the CNAME is still wrong", async () => {
    const { service, repo } = setup({ cname: ["elsewhere.example.net"] });
    repo.seed({ orgId: ORG, hostname: HOST, status: "failed", lastError: "cname_missing" });
    expect(await service.refresh(ORG)).toMatchObject({ status: "failed" });
  });

  it("failed -> active again once CNAME and HTTPS recover, keeping the first activatedAt", async () => {
    const earlier = new Date(NOW.getTime() - 86_400_000);
    const { service, repo } = setup({ cname: [DEFAULT_CNAME_TARGET], probe: { ok: true } });
    repo.seed({ orgId: ORG, hostname: HOST, status: "failed", sslStatus: "issued", activatedAt: earlier });
    expect(await service.refresh(ORG)).toMatchObject({
      status: "active",
      activatedAt: earlier,
      lastError: null,
    });
  });

  it("active with a failing HTTPS probe stays active and records the error", async () => {
    const earlier = new Date(NOW.getTime() - 86_400_000);
    const { service, repo } = setup({
      cname: [DEFAULT_CNAME_TARGET],
      probe: { ok: false, error: "ETIMEDOUT" },
    });
    repo.seed({
      orgId: ORG,
      hostname: HOST,
      status: "active",
      sslStatus: "issued",
      cnameVerifiedAt: earlier,
      activatedAt: earlier,
    });
    expect(await service.refresh(ORG)).toMatchObject({
      status: "active",
      sslStatus: "issued",
      cnameVerifiedAt: earlier,
      lastError: "https_probe: ETIMEDOUT",
    });
  });

  it("a DNS lookup error leaves status untouched and records lastError", async () => {
    const { service, repo, probeHttps } = setup({ cname: new Error("SERVFAIL") });
    repo.seed({ orgId: ORG, hostname: HOST });
    expect(await service.refresh(ORG)).toMatchObject({
      status: "pending_dns",
      lastCheckedAt: NOW,
      lastError: "dns_lookup_failed: SERVFAIL",
    });
    expect(probeHttps).not.toHaveBeenCalled();
  });
});

describe("isHostnameApproved", () => {
  it("matches the normalized host exactly and nothing else", async () => {
    const repo = new FakeCustomHostnameRepository(() => NOW);
    repo.seed({ orgId: ORG, hostname: HOST, status: "active" });
    expect(await isHostnameApproved(repo, "BOOK.acme.com.")).toBe(true);
    expect(await isHostnameApproved(repo, "acme.com")).toBe(false);
    expect(await isHostnameApproved(repo, "x.book.acme.com")).toBe(false);
    expect(await isHostnameApproved(repo, "book.acme.co")).toBe(false);
    expect(await isHostnameApproved(repo, "")).toBe(false);
    expect(await isHostnameApproved(repo, `${"a".repeat(250)}.com`)).toBe(false);
  });
});

describe("cleanupStaleHostnames", () => {
  const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

  function seeded() {
    const repo = new FakeCustomHostnameRepository(() => NOW);
    const stalePending = repo.seed({ orgId: "o1", hostname: "a.acme.com", createdAt: hoursAgo(49) });
    const staleFailed = repo.seed({
      orgId: "o2",
      hostname: "b.acme.com",
      status: "failed",
      createdAt: hoursAgo(72),
    });
    const freshPending = repo.seed({ orgId: "o3", hostname: "c.acme.com", createdAt: hoursAgo(47) });
    const oldActive = repo.seed({
      orgId: "o4",
      hostname: "d.acme.com",
      status: "active",
      activatedAt: hoursAgo(90),
      createdAt: hoursAgo(100),
    });
    const onceActiveNowFailed = repo.seed({
      orgId: "o5",
      hostname: "e.acme.com",
      status: "failed",
      activatedAt: hoursAgo(80),
      createdAt: hoursAgo(100),
    });
    return { repo, stalePending, staleFailed, freshPending, oldActive, onceActiveNowFailed };
  }

  it("uses a 48 h cutoff", () => {
    expect(STALE_AFTER_MS).toBe(48 * 3_600_000);
  });

  it("deletes only rows never activated and older than 48 h, one at a time", async () => {
    const { repo, stalePending, staleFailed, freshPending, oldActive, onceActiveNowFailed } = seeded();
    const result = await cleanupStaleHostnames(repo, { dryRun: false, now: NOW });
    expect(result).toEqual({
      dryRun: false,
      candidates: 2,
      deleted: 2,
      hostnames: ["b.acme.com", "a.acme.com"],
    });
    expect(repo.deleteCalls).toEqual([staleFailed.id, stalePending.id]);
    expect(Array.from(repo.rows.keys()).sort()).toEqual(
      [freshPending.id, oldActive.id, onceActiveNowFailed.id].sort()
    );
  });

  it("dry-run reports candidates and deletes nothing", async () => {
    const { repo } = seeded();
    const result = await cleanupStaleHostnames(repo, { dryRun: true, now: NOW });
    expect(result).toMatchObject({ dryRun: true, candidates: 2, deleted: 0 });
    expect(repo.deleteCalls).toEqual([]);
    expect(repo.rows.size).toBe(5);
  });

  it("skips a candidate that activated between listing and delete", async () => {
    const { repo, stalePending } = seeded();
    const list = repo.listNeverActivatedBefore.bind(repo);
    repo.listNeverActivatedBefore = async (cutoff: Date) => {
      const rows = await list(cutoff);
      await repo.update("o1", stalePending.id, { status: "active", activatedAt: NOW });
      return rows;
    };
    const result = await cleanupStaleHostnames(repo, { dryRun: false, now: NOW });
    expect(result).toMatchObject({ candidates: 2, deleted: 1 });
    expect(repo.rows.has(stalePending.id)).toBe(true);
  });

  it("row exactly 48 h old is kept", async () => {
    const repo = new FakeCustomHostnameRepository(() => NOW);
    repo.seed({ orgId: "o1", hostname: "a.acme.com", createdAt: hoursAgo(48) });
    expect(await cleanupStaleHostnames(repo, { dryRun: false, now: NOW })).toMatchObject({
      candidates: 0,
      deleted: 0,
    });
  });
});
