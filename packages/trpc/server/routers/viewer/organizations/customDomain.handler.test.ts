import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@calcom/prisma", () => ({ prisma: {} }));

import type { CustomDomainHandlerDeps } from "./customDomain.handler";
import { customDomainHandler } from "./customDomain.handler";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const row = { id: "h1", orgId: ORG, hostname: "book.example.com", status: "pending_dns" };
const ACTIONS = ["get", "add", "refresh", "remove"] as const;

function makeDeps(adminOrgIds: string[] = [ORG]) {
  const repository = { listAdminOrgIds: vi.fn().mockResolvedValue(adminOrgIds) };
  const service = {
    get: vi.fn().mockResolvedValue(row),
    addHostname: vi.fn().mockResolvedValue(row),
    refresh: vi.fn().mockResolvedValue({ ...row, status: "active" }),
    remove: vi.fn().mockResolvedValue(true),
  };
  // The handler only touches these members; the cast keeps the fakes minimal.
  const deps = { repository, service } as unknown as CustomDomainHandlerDeps;
  return { deps, repository, service };
}

const ctx = { user: { id: 42 } } as unknown as Parameters<typeof customDomainHandler>[1]["ctx"];

async function expectCode(p: Promise<unknown>, code: TRPCError["code"]) {
  const err = await p.then(
    () => null,
    (e: unknown) => e
  );
  expect(err).toBeInstanceOf(TRPCError);
  expect((err as TRPCError).code).toBe(code);
}

describe("viewer.organizations.customDomain handler", () => {
  beforeEach(() => {
    vi.stubEnv("TW_CUSTOM_DOMAINS_ENABLED", "true");
    vi.stubEnv("TW_CUSTOM_DOMAIN_CNAME_TARGET", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each(ACTIONS)("NOT_FOUND for %s when the flag is off", async (action) => {
    vi.stubEnv("TW_CUSTOM_DOMAINS_ENABLED", "false");
    const { deps, repository, service } = makeDeps();
    await expectCode(
      customDomainHandler(action, { ctx, input: { orgId: ORG, hostname: "book.example.com" } }, deps),
      "NOT_FOUND"
    );
    expect(repository.listAdminOrgIds).not.toHaveBeenCalled();
    expect(Object.values(service).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it("NOT_FOUND when the flag is unset", async () => {
    vi.stubEnv("TW_CUSTOM_DOMAINS_ENABLED", "");
    const { deps } = makeDeps();
    await expectCode(customDomainHandler("get", { ctx, input: { orgId: ORG } }, deps), "NOT_FOUND");
  });

  it.each(ACTIONS)("FORBIDDEN for %s when the user is not an admin/owner of the org", async (action) => {
    const { deps, repository, service } = makeDeps([OTHER_ORG]);
    await expectCode(
      customDomainHandler(action, { ctx, input: { orgId: ORG, hostname: "book.example.com" } }, deps),
      "FORBIDDEN"
    );
    expect(repository.listAdminOrgIds).toHaveBeenCalledWith(42);
    expect(Object.values(service).every((fn) => fn.mock.calls.length === 0)).toBe(true);
  });

  it("FORBIDDEN when the user has no admin memberships at all", async () => {
    const { deps } = makeDeps([]);
    await expectCode(customDomainHandler("get", { ctx, input: { orgId: ORG } }, deps), "FORBIDDEN");
  });

  it("get calls service.get and returns the CNAME target", async () => {
    const { deps, service } = makeDeps();
    const res = await customDomainHandler("get", { ctx, input: { orgId: ORG } }, deps);
    expect(service.get).toHaveBeenCalledWith(ORG);
    expect(res).toEqual({ hostname: row, cnameTarget: "customers.timeway.co" });
  });

  it("add calls service.addHostname with the org and hostname", async () => {
    const { deps, service } = makeDeps();
    const res = await customDomainHandler(
      "add",
      { ctx, input: { orgId: ORG, hostname: "book.example.com" } },
      deps
    );
    expect(service.addHostname).toHaveBeenCalledWith(ORG, "book.example.com");
    expect(res).toEqual({ hostname: row, cnameTarget: "customers.timeway.co" });
  });

  it("refresh calls service.refresh", async () => {
    const { deps, service } = makeDeps();
    const res = await customDomainHandler("refresh", { ctx, input: { orgId: ORG } }, deps);
    expect(service.refresh).toHaveBeenCalledWith(ORG);
    expect(res).toMatchObject({ hostname: { status: "active" } });
  });

  it("remove calls service.remove", async () => {
    const { deps, service } = makeDeps();
    const res = await customDomainHandler("remove", { ctx, input: { orgId: ORG } }, deps);
    expect(service.remove).toHaveBeenCalledWith(ORG);
    expect(res).toEqual({ removed: true });
  });

  it("propagates service errors unchanged so the error middleware can map them", async () => {
    const { deps, service } = makeDeps();
    const boom = new Error("custom hostname rejected: apex");
    service.addHostname.mockRejectedValueOnce(boom);
    await expect(
      customDomainHandler("add", { ctx, input: { orgId: ORG, hostname: "example.com" } }, deps)
    ).rejects.toBe(boom);
  });
});
