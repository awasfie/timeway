import { describe, expect, it } from "vitest";
import type { OrgLandingPort } from "../orgLanding";
import { accentColorFromBrand, loadOrgLanding, safeLogoUrl } from "../orgLanding";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

type Fixture = {
  org?: Awaited<ReturnType<OrgLandingPort["findActiveOrgBySlug"]>>;
  users?: Awaited<ReturnType<OrgLandingPort["listOrgUsers"]>>;
  all?: Awaited<ReturnType<OrgLandingPort["listUsersByUsername"]>>;
  events?: Awaited<ReturnType<OrgLandingPort["listPublicEventTypes"]>>;
  team?: Awaited<ReturnType<OrgLandingPort["listTeamEventTypesBySlug"]>>;
};

function port(f: Fixture) {
  const calls: string[] = [];
  const p: OrgLandingPort = {
    async findActiveOrgBySlug(slug) {
      calls.push(`org:${slug}`);
      return f.org === undefined
        ? { id: ORG, slug: "acme", name: "Acme", logoUrl: null, brand: null }
        : f.org;
    },
    async listOrgUsers() {
      return f.users ?? [];
    },
    async listUsersByUsername(names) {
      calls.push(`users:${names.join(",")}`);
      return (f.all ?? []).filter((r) => names.includes(r.username.toLowerCase()));
    },
    async listPublicEventTypes(ids) {
      return (f.events ?? []).filter((e) => ids.includes(e.userId));
    },
    async listTeamEventTypesBySlug() {
      return f.team ?? [];
    },
  };
  return { p, calls };
}

const ev = (userId: number, slug: string, twOrgId: string | null = ORG) => ({
  userId,
  slug,
  title: slug,
  length: 30,
  twOrgId,
});
const tev = (slug: string, over: Partial<NonNullable<Fixture["team"]>[number]> = {}) => ({
  teamId: 2,
  teamSlug: "acme",
  slug,
  title: slug,
  length: 15,
  twOrgId: ORG,
  managed: false,
  ...over,
});

describe("loadOrgLanding", () => {
  it("returns null for an unknown or inactive slug (page 404s)", async () => {
    expect(await loadOrgLanding(port({ org: null }).p, "nope")).toBeNull();
  });

  it("rejects malformed slugs without a DB call", async () => {
    const { p, calls } = port({});
    expect(await loadOrgLanding(p, "../etc")).toBeNull();
    expect(await loadOrgLanding(p, "%E0%A4%A")).toBeNull();
    expect(calls).toEqual([]);
  });

  it("lowercases the slug before lookup", async () => {
    const { p, calls } = port({});
    await loadOrgLanding(p, "ACME");
    expect(calls[0]).toBe("org:acme");
  });

  it("lists members whose username is wholly this org's, with their public links", async () => {
    const { p } = port({
      users: [
        { id: 1, username: "marc.azer", name: "Marc", locked: false },
        { id: 2, username: "dup", name: "Dup", locked: false },
        { id: 3, username: "locked", name: "Locked", locked: true },
        { id: 4, username: null, name: "No username", locked: false },
        { id: 5, username: "noevents", name: "No events", locked: false },
      ],
      all: [
        { username: "marc.azer", twOrgId: ORG },
        { username: "dup", twOrgId: ORG },
        { username: "dup", twOrgId: OTHER },
        { username: "noevents", twOrgId: ORG },
      ],
      events: [ev(1, "30min"), ev(1, "foreign", OTHER), ev(2, "15min")],
    });
    const landing = await loadOrgLanding(p, "acme");
    expect(landing?.members).toEqual([
      {
        name: "Marc",
        username: "marc.azer",
        href: "/marc.azer",
        links: [{ title: "30min", length: 30, href: "/marc.azer/30min" }],
      },
    ]);
  });

  it("never carries an email or other contact field", async () => {
    const { p } = port({
      users: [{ id: 1, username: "a", name: null, locked: false }],
      all: [{ username: "a", twOrgId: ORG }],
      events: [ev(1, "x")],
    });
    const json = JSON.stringify(await loadOrgLanding(p, "acme"));
    expect(json).not.toMatch(/@|email/i);
    expect(json).toContain('"name":"a"');
  });

  it("lists the org team's links only when one team owns the slug and every event is this org's", async () => {
    expect((await loadOrgLanding(port({ team: [tev("intro"), tev("demo")] }).p, "acme"))?.teamLinks).toEqual([
      { title: "intro", length: 15, href: "/team/acme/intro" },
      { title: "demo", length: 15, href: "/team/acme/demo" },
    ]);
    const twoTeams = [tev("intro"), tev("demo", { teamId: 9 })];
    expect((await loadOrgLanding(port({ team: twoTeams }).p, "acme"))?.teamLinks).toEqual([]);
    const foreign = [tev("intro"), tev("demo", { twOrgId: OTHER })];
    expect((await loadOrgLanding(port({ team: foreign }).p, "acme"))?.teamLinks).toEqual([]);
    const managed = [tev("intro", { managed: true })];
    expect((await loadOrgLanding(port({ team: managed }).p, "acme"))?.teamLinks).toEqual([]);
  });

  it("renders an empty org (no members, no team) instead of 404", async () => {
    const landing = await loadOrgLanding(port({}).p, "acme");
    expect(landing).toMatchObject({ org: { name: "Acme" }, teamLinks: [], members: [] });
  });
});

describe("safeLogoUrl / accentColorFromBrand", () => {
  it.each([
    ["https://cdn.acme.com/l.png", "https://cdn.acme.com/l.png"],
    ["/api/logo", "/api/logo"],
    ["//evil.com/x.png", null],
    ["http://acme.com/l.png", null],
    ["javascript:alert(1)", null],
    ["data:image/png;base64,AAAA", null],
    [null, null],
  ])("logo %s -> %s", (input, out) => {
    expect(safeLogoUrl(input)).toBe(out);
  });

  it.each([
    [{ primaryColor: "#112233" }, "#112233"],
    [{ brandColor: "#abc" }, "#abc"],
    [{ primaryColor: "red;background:url(x)" }, null],
    [["#112233"], null],
    [null, null],
  ])("brand %j -> %s", (input, out) => {
    expect(accentColorFromBrand(input)).toBe(out);
  });
});
