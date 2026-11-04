import { afterEach, describe, expect, it } from "vitest";
import { isOrgBrandingHidden } from "../tw-branding/branding";
import { ProvisionError } from "./provision";
import {
  createSubOrg,
  getSubOrg,
  listSubOrgs,
  parseSubOrgBody,
  parseSubOrgPatch,
  patchSubOrg,
  type SubOrgClient,
} from "./subOrgs";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

type Org = Record<string, any>;

function store(seed: Org[]) {
  const rows: Org[] = seed.map((o) => ({
    status: "active",
    isSandbox: false,
    hideBranding: false,
    billingAttribution: "self",
    parentOrgId: null,
    externalRef: null,
    planCode: null,
    createdAt: new Date(),
    ...o,
  }));
  let n = 0;
  const match = (r: Org, where: Org) => Object.entries(where).every(([k, v]) => r[k] === v);
  const tx = {
    $executeRaw: async () => 1,
    organization: {
      findUnique: async ({ where }: { where: Org }) => rows.find((r) => match(r, where)) ?? null,
      findFirst: async ({ where }: { where: Org }) => rows.find((r) => match(r, where)) ?? null,
      findMany: async ({ where }: { where: Org }) => rows.filter((r) => match(r, where)),
      create: async ({ data }: { data: Org }) => {
        if (rows.some((r) => r.externalRef === data.externalRef || r.slug === data.slug)) {
          throw Object.assign(new Error("unique"), { code: "P2002" });
        }
        const row = {
          id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
          status: "active",
          planCode: null,
          createdAt: new Date(),
          ...data,
        };
        rows.push(row);
        return row;
      },
      update: async ({ where, data }: { where: Org; data: Org }) => {
        const r = rows.find((x) => x.id === where.id)!;
        Object.assign(r, data);
        return r;
      },
    },
  };
  const client = {
    $transaction: async <R>(fn: (t: typeof tx) => Promise<R>) => fn(tx),
  };
  return { rows, client: client as unknown as SubOrgClient };
}

const body = (o: Record<string, unknown> = {}) =>
  parseSubOrgBody({ client_ref: "c1", name: "Client One", ...o });

const seed = () => [
  { id: P1, slug: "agency", name: "Agency", planCode: "agency" },
  { id: P2, slug: "other", name: "Other" },
];

describe("sub-org create", () => {
  it("creates, inherits sandbox, stores the namespaced ref and exposes client_ref only", async () => {
    const s = store([{ ...seed()[0], isSandbox: true }, seed()[1]]);
    const r = await createSubOrg(s.client, P1, body());
    expect(r.created).toBe(true);
    expect(r.org).toMatchObject({
      client_ref: "c1",
      parent_org_id: P1,
      is_sandbox: true,
      slug: "client-one",
    });
    expect(s.rows.find((x) => x.parentOrgId === P1)!.externalRef).toBe(`sub:${P1}:c1`);
    expect(JSON.stringify(r.org)).not.toContain("sub:");
  });

  it("replay -> same org, one row; different body -> 409", async () => {
    const s = store(seed());
    const a = await createSubOrg(s.client, P1, body());
    const b = await createSubOrg(s.client, P1, body());
    expect(b.created).toBe(false);
    expect(b.org.id).toBe(a.org.id);
    expect(s.rows.filter((r) => r.parentOrgId === P1)).toHaveLength(1);
    await expect(createSubOrg(s.client, P1, body({ name: "Changed" }))).rejects.toMatchObject({
      status: 409,
      code: "client_ref_conflict",
    });
  });

  it("concurrent double-create -> one row", async () => {
    const s = store(seed());
    const [a, b] = await Promise.all([
      createSubOrg(s.client, P1, body({ slug: "dup" })),
      createSubOrg(s.client, P1, body({ slug: "dup" })),
    ]);
    expect(a.org.id).toBe(b.org.id);
    expect(s.rows.filter((r) => r.parentOrgId === P1)).toHaveLength(1);
  });

  it("same client_ref under two parents are two orgs", async () => {
    const s = store(seed());
    const a = await createSubOrg(s.client, P1, body());
    const b = await createSubOrg(s.client, P2, body());
    expect(a.org.id).not.toBe(b.org.id);
  });

  it("one-level rule: a sub-org cannot own sub-orgs", async () => {
    const s = store(seed());
    const sub = await createSubOrg(s.client, P1, body());
    await expect(createSubOrg(s.client, sub.org.id, body({ client_ref: "c2" }))).rejects.toMatchObject({
      status: 409,
      code: "sub_org_depth",
    });
  });

  it("explicit slug clash -> 409 slug_taken; derived slug gets a suffix", async () => {
    const s = store(seed());
    await expect(createSubOrg(s.client, P1, body({ slug: "other" }))).rejects.toMatchObject({
      code: "slug_taken",
    });
    s.rows.push({ id: "x", slug: "client-one" });
    const r = await createSubOrg(s.client, P1, body());
    expect(r.org.slug).toMatch(/^client-one-[0-9a-f]{6}$/);
  });

  it("unknown parent -> 404", async () => {
    const s = store([]);
    await expect(createSubOrg(s.client, P1, body())).rejects.toBeInstanceOf(ProvisionError);
  });
});

describe("branding gate (E4)", () => {
  const prev = process.env.TW_UNBRANDED_PLAN_CODES;
  afterEach(() => {
    if (prev === undefined) delete process.env.TW_UNBRANDED_PLAN_CODES;
    else process.env.TW_UNBRANDED_PLAN_CODES = prev;
  });

  it("403 not_entitled when the plan is not allowlisted (create and patch)", async () => {
    delete process.env.TW_UNBRANDED_PLAN_CODES;
    const s = store(seed());
    await expect(createSubOrg(s.client, P1, body({ hide_branding: true }))).rejects.toMatchObject({
      status: 403,
      code: "not_entitled",
    });
    const sub = await createSubOrg(s.client, P1, body());
    await expect(patchSubOrg(s.client, P1, sub.org.id, { hideBranding: true })).rejects.toMatchObject({
      status: 403,
    });
    expect(s.rows.find((r) => r.id === sub.org.id)!.hideBranding).toBe(false);
  });

  it("entitled through the parent's plan; billing attribution patches freely", async () => {
    process.env.TW_UNBRANDED_PLAN_CODES = "agency";
    const s = store(seed());
    const sub = await createSubOrg(s.client, P1, body());
    const p = await patchSubOrg(s.client, P1, sub.org.id, {
      hideBranding: true,
      billingAttribution: "parent",
    });
    expect(p).toMatchObject({
      hide_branding: true,
      billing_attribution: "parent",
    });
    expect(await isOrgBrandingHidden(s.client, sub.org.id)).toBe(true);
    // plan change takes effect at once
    process.env.TW_UNBRANDED_PLAN_CODES = "other-plan";
    expect(await isOrgBrandingHidden(s.client, sub.org.id)).toBe(false);
    // switching off is never gated
    expect(await patchSubOrg(s.client, P1, sub.org.id, { hideBranding: false })).toMatchObject({
      hide_branding: false,
    });
  });

  it("isOrgBrandingHidden: no org / unflagged / error -> branded", async () => {
    process.env.TW_UNBRANDED_PLAN_CODES = "agency";
    const s = store(seed());
    expect(await isOrgBrandingHidden(s.client, null)).toBe(false);
    expect(await isOrgBrandingHidden(s.client, P1)).toBe(false);
    expect(await isOrgBrandingHidden({ $transaction: async () => Promise.reject(new Error("x")) }, P1)).toBe(
      false
    );
  });
});

describe("scoping", () => {
  it("list/get/patch never cross parents (404 -> null)", async () => {
    const s = store(seed());
    const sub = await createSubOrg(s.client, P1, body());
    expect(await listSubOrgs(s.client, P1)).toHaveLength(1);
    expect(await listSubOrgs(s.client, P2)).toHaveLength(0);
    expect(await getSubOrg(s.client, P1, sub.org.id)).toMatchObject({
      client_ref: "c1",
    });
    expect(await getSubOrg(s.client, P2, sub.org.id)).toBeNull();
    expect(await getSubOrg(s.client, P1, "not-a-uuid")).toBeNull();
    expect(
      await patchSubOrg(s.client, P2, sub.org.id, {
        billingAttribution: "parent",
      })
    ).toBeNull();
    expect(s.rows.find((r) => r.id === sub.org.id)!.billingAttribution).toBe("self");
  });
});

describe("body parsing", () => {
  it.each([
    [null],
    [{}],
    [{ client_ref: "a" }],
    [{ client_ref: "a", name: "n", billing_attribution: "x" }],
    [{ client_ref: "a", name: "n", hide_branding: "yes" }],
    [{ client_ref: "a", name: "n", slug: "Bad Slug" }],
  ])("rejects %j", (b) => {
    expect(() => parseSubOrgBody(b)).toThrow(ProvisionError);
  });
  it("patch needs a field", () => {
    expect(() => parseSubOrgPatch({})).toThrow(ProvisionError);
    expect(parseSubOrgPatch({ hide_branding: true })).toEqual({
      hideBranding: true,
    });
  });
});
