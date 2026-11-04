/**
 * WC-TW-14b: sub-org create against a real Postgres. The concurrent double-create must leave one row
 * (the P2002 path), replay is idempotent, cross-parent reads are 404, one-level rule holds.
 * Integration DB only; every row is tagged with a per-run ref and removed afterwards.
 */
import { randomBytes } from "node:crypto";
import process from "node:process";
import type { OrgApiClient } from "../../../../packages/features/tw-provisioning/orgApi";
import { handleOrgApi } from "../../../../packages/features/tw-provisioning/orgApi";
import { createSubOrg, getSubOrg } from "../../../../packages/features/tw-provisioning/subOrgs";
import { prisma } from "@calcom/prisma";
import { withTwPlatform } from "@calcom/prisma/tw-org-context";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MASTER = `master-${randomBytes(16).toString("hex")}`;
const run = randomBytes(3).toString("hex");
const client = prisma as unknown as OrgApiClient;
const orgIds: string[] = [];
const deps = { client, getSlots: async () => ({ slots: {} }), limiter: () => true };
// biome-ignore lint/suspicious/noExplicitAny: test helper
type R = { status: number; body: any };
const call = (method: string, path: string[], authorization: string | null, body?: unknown): Promise<R> =>
  handleOrgApi({ method, path, authorization, query: new URLSearchParams(""), body }, deps) as Promise<R>;

const mkParent = async (ref: string) => {
  const email = `tw-14b-${run}-${ref}@t14b.test`;
  const r = await call("POST", [], `Bearer ${MASTER}`, {
    external_ref: `t14b-${run}-${ref}`,
    name: `T14b ${ref}`,
    slug: `t14b-${run}-${ref}`,
    owner: { email, name: "Owner", timezone: "Asia/Dubai" },
  });
  expect(r.status).toBe(201);
  orgIds.push(r.body.org.id);
  return r.body.org.id as string;
};
const body = (over: Record<string, unknown> = {}) => ({
  clientRef: "c1",
  name: "Client One",
  hideBranding: false,
  billingAttribution: "self" as const,
  ...over,
});

beforeAll(() => {
  process.env.TW_PLATFORM_MASTER_KEY = MASTER;
});

afterAll(async () => {
  await withTwPlatform(client as never, "WC-TW-14b test cleanup", async (tx: any) => {
    const subs = await tx.organization.findMany({
      where: { parentOrgId: { in: orgIds } },
      select: { id: true },
    });
    const all = [...orgIds, ...subs.map((s: { id: string }) => s.id)];
    const users = await tx.user.findMany({
      where: { email: { contains: `tw-14b-${run}-` } },
      select: { id: true },
    });
    const ids = users.map((u: { id: number }) => u.id);
    await tx.webhook.deleteMany({ where: { userId: { in: ids } } });
    await tx.eventType.deleteMany({ where: { userId: { in: ids } } });
    await tx.schedule.deleteMany({ where: { userId: { in: ids } } });
    await tx.organizationMember.deleteMany({ where: { orgId: { in: all } } });
    await tx.orgEntitlementOverride?.deleteMany({ where: { orgId: { in: all } } });
    await tx.orgApiKey.deleteMany({ where: { orgId: { in: all } } });
    await tx.user.deleteMany({ where: { id: { in: ids } } });
    await tx.organization.deleteMany({ where: { id: { in: subs.map((s: { id: string }) => s.id) } } });
    await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
  });
});

describe("WC-TW-14b sub-orgs on Postgres", () => {
  it("concurrent double-create -> one row, same org", async () => {
    const p = await mkParent("a");
    const [x, y] = await Promise.all([
      createSubOrg(client as never, p, body({ slug: `t14b-${run}-dup` }) as never),
      createSubOrg(client as never, p, body({ slug: `t14b-${run}-dup` }) as never),
    ]);
    expect(x.org.id).toBe(y.org.id);
    const rows = await withTwPlatform(client as never, "count", (tx: any) =>
      tx.organization.count({ where: { parentOrgId: p } })
    );
    expect(rows).toBe(1);
  });

  it("replay is idempotent; different body -> 409; cross-parent read -> 404; one level", async () => {
    const p1 = await mkParent("b");
    const p2 = await mkParent("c");
    const a = await createSubOrg(client as never, p1, body() as never);
    expect(a.created).toBe(true);
    const b = await createSubOrg(client as never, p1, body() as never);
    expect(b.created).toBe(false);
    expect(b.org.id).toBe(a.org.id);
    await expect(createSubOrg(client as never, p1, body({ name: "Other" }) as never)).rejects.toMatchObject({
      status: 409,
    });
    expect(await getSubOrg(client as never, p2, a.org.id)).toBeNull(); // router maps null to 404
    await expect(
      createSubOrg(client as never, a.org.id, body({ clientRef: "c2" }) as never)
    ).rejects.toMatchObject({ status: 409, code: "sub_org_depth" });
    const g = await getSubOrg(client as never, p1, a.org.id);
    expect(g?.id).toBe(a.org.id);
  });

  it("hideBranding without entitlement -> 403", async () => {
    const p = await mkParent("d");
    await expect(
      createSubOrg(client as never, p, body({ clientRef: "c3", hideBranding: true }) as never)
    ).rejects.toMatchObject({ status: 403 });
  });
});
