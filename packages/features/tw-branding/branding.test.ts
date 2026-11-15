import { describe, expect, it } from "vitest";
import {
  applyBranding,
  getOrgBranding,
  isAllowedLogoUrl,
  overlayBranding,
  parseBrandingBody,
} from "./branding";

const HOSTS = ["assets.example.test"];

describe("parseBrandingBody", () => {
  it("accepts hex colours and an allow-listed https logo", () => {
    expect(
      parseBrandingBody(
        { brand_color: "#1A73E8", dark_brand_color: "#fff", logo_url: "https://assets.example.test/o/1.png" },
        HOSTS
      )
    ).toEqual({
      brandColor: "#1a73e8",
      darkBrandColor: "#fff",
      logoUrl: "https://assets.example.test/o/1.png",
    });
  });
  it("null clears a field", () => {
    expect(parseBrandingBody({ logo_url: null, brand_color: null }, HOSTS)).toEqual({
      logoUrl: null,
      brandColor: null,
    });
  });
  it.each([
    [{ brand_color: "red" }],
    [{ brand_color: "#12345" }],
    [{ brand_color: "#fff;background:url(x)" }],
    [{ logo_url: "http://assets.example.test/a.png" }],
    [{ logo_url: "https://evil.test/a.png" }],
    [{ logo_url: "https://assets.example.test.evil.test/a.png" }],
    [{ logo_url: "https://u:p@assets.example.test/a.png" }],
    [{ logo_url: "javascript:alert(1)" }],
    [{}],
    [[]],
    ["x"],
  ])("rejects %j", (b) => {
    expect(parseBrandingBody(b, HOSTS)).toHaveProperty("error");
  });
  it("no host configured = no logo accepted", () => {
    expect(isAllowedLogoUrl("https://assets.example.test/a.png", [])).toBe(false);
  });
});

describe("overlayBranding", () => {
  const p = { brandColor: "#797979", darkBrandColor: "#fafafa" };
  const e = { logoUrl: null as string | null, name: "Team" as string | null };
  it("overlays set fields, keeps defaults for null", () => {
    const r = overlayBranding(p, e, {
      name: "Acme",
      logoUrl: "https://assets.example.test/a.png",
      brandColor: "#112233",
      darkBrandColor: null,
    });
    expect(r.profile).toEqual({ brandColor: "#112233", darkBrandColor: "#fafafa" });
    expect(r.entity).toEqual({ logoUrl: "https://assets.example.test/a.png", name: "Acme" });
  });
  it("no branding = unchanged", () => {
    expect(overlayBranding(p, e, null)).toEqual({ profile: p, entity: e });
  });
});

function fakeClient(rows: Record<string, { name: string; logoUrl: string | null; brand: unknown }>) {
  const ctx: { org?: string } = {};
  const tx = {
    $executeRaw: async (_s: TemplateStringsArray, v: string) => {
      ctx.org = v;
      return 1;
    },
    organization: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        where.id === ctx.org ? (rows[where.id] ?? null) : null,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        Object.assign(rows[where.id], data);
        return rows[where.id];
      },
    },
  };
  return { $transaction: async <R>(fn: (t: typeof tx) => Promise<R>) => fn(tx) };
}
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("per-org store", () => {
  it("branding is per org: A's write never shows on B", async () => {
    const rows = {
      [A]: { name: "A", logoUrl: null, brand: null },
      [B]: { name: "B", logoUrl: null, brand: null },
    };
    const c = fakeClient(rows);
    await applyBranding(c, A, { brandColor: "#abcdef", logoUrl: "https://assets.example.test/a.png" });
    expect(await getOrgBranding(c, A)).toMatchObject({
      brandColor: "#abcdef",
      logoUrl: "https://assets.example.test/a.png",
    });
    expect(await getOrgBranding(c, B)).toMatchObject({ brandColor: null, logoUrl: null });
  });
  it("merges colours, clears with null", async () => {
    const rows = { [A]: { name: "A", logoUrl: null, brand: { brandColor: "#111111" } } };
    const c = fakeClient(rows);
    await applyBranding(c, A, { darkBrandColor: "#222222" });
    expect(await getOrgBranding(c, A)).toMatchObject({ brandColor: "#111111", darkBrandColor: "#222222" });
    await applyBranding(c, A, { brandColor: null });
    expect(await getOrgBranding(c, A)).toMatchObject({ brandColor: null, darkBrandColor: "#222222" });
  });
  it("unknown org -> null", async () => {
    expect(await getOrgBranding(fakeClient({}), A)).toBeNull();
  });
});
