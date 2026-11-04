import { afterEach, describe, expect, it, vi } from "vitest";
import type { CustomHostResolverPort } from "../resolve";
import { createResolveCache, RESOLVE_CACHE_TTL_MS, resolveCustomHost } from "../resolve";

const ACME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

type HostRow = {
  hostname: string;
  orgId: string;
  orgSlug: string;
  status: "active" | "pending_dns" | "failed";
};

function fakePort(opts: {
  hosts?: HostRow[];
  users?: { username: string; twOrgId: string | null }[];
  teams?: { slug: string; parentSlug: string | null; eventTypeOrgIds: (string | null)[] }[];
}): CustomHostResolverPort {
  return {
    findActiveOrgByHostname: vi.fn(async (hostname: string) => {
      const row = (opts.hosts ?? []).find((h) => h.hostname === hostname && h.status === "active");
      return row ? { orgId: row.orgId, orgSlug: row.orgSlug } : null;
    }),
    listUsersByUsername: vi.fn(async (names: string[]) =>
      (opts.users ?? []).filter((u) => names.includes(u.username.toLowerCase()))
    ),
    listTeamsBySlug: vi.fn(async (slug: string) =>
      (opts.teams ?? []).filter((t) => t.slug.toLowerCase() === slug)
    ),
  };
}

const hosts: HostRow[] = [
  { hostname: "book.acme.com", orgId: ACME, orgSlug: "acme", status: "active" },
  { hostname: "pending.acme.com", orgId: ACME, orgSlug: "acme", status: "pending_dns" },
  { hostname: "failed.acme.com", orgId: ACME, orgSlug: "acme", status: "failed" },
];

describe("resolveCustomHost", () => {
  it("resolves an active host to its org", async () => {
    const port = fakePort({ hosts });
    expect(await resolveCustomHost(port, { host: "Book.Acme.com." })).toEqual({ ok: true, orgSlug: "acme" });
  });

  it.each([
    "pending.acme.com",
    "failed.acme.com",
    "unknown.example.com",
    "",
  ])("%s is denied", async (host) => {
    expect(await resolveCustomHost(fakePort({ hosts }), { host })).toEqual({ ok: false });
  });

  it("allows users wholly in the host's org", async () => {
    const port = fakePort({
      hosts,
      users: [
        { username: "alice", twOrgId: ACME },
        { username: "Bob", twOrgId: ACME },
      ],
    });
    expect(await resolveCustomHost(port, { host: "book.acme.com", users: ["alice", "bob"] })).toEqual({
      ok: true,
      orgSlug: "acme",
    });
  });

  it("denies another org's user", async () => {
    const port = fakePort({ hosts, users: [{ username: "mallory", twOrgId: OTHER }] });
    expect(await resolveCustomHost(port, { host: "book.acme.com", users: ["mallory"] })).toEqual({
      ok: false,
    });
  });

  it("denies a username shared with another org (slugs are not unique upstream)", async () => {
    const port = fakePort({
      hosts,
      users: [
        { username: "alice", twOrgId: ACME },
        { username: "alice", twOrgId: OTHER },
      ],
    });
    expect(await resolveCustomHost(port, { host: "book.acme.com", users: ["alice"] })).toEqual({ ok: false });
  });

  it("denies unknown and org-less users, and a mix with one foreign user", async () => {
    const port = fakePort({
      hosts,
      users: [
        { username: "alice", twOrgId: ACME },
        { username: "loner", twOrgId: null },
        { username: "mallory", twOrgId: OTHER },
      ],
    });
    for (const users of [["ghost"], ["loner"], ["alice", "mallory"]]) {
      expect(await resolveCustomHost(port, { host: "book.acme.com", users })).toEqual({ ok: false });
    }
  });

  it("allows teams owned by the org via slug, parent or event types", async () => {
    const port = fakePort({
      hosts,
      teams: [
        { slug: "acme", parentSlug: null, eventTypeOrgIds: [] },
        { slug: "sales", parentSlug: "acme", eventTypeOrgIds: [] },
        { slug: "ops", parentSlug: null, eventTypeOrgIds: [ACME, ACME] },
      ],
    });
    for (const team of ["acme", "sales", "OPS"]) {
      expect(await resolveCustomHost(port, { host: "book.acme.com", team })).toEqual({
        ok: true,
        orgSlug: "acme",
      });
    }
  });

  it("denies another org's team, an unknown team, and an ambiguous slug", async () => {
    const port = fakePort({
      hosts,
      teams: [
        { slug: "rivals", parentSlug: "other", eventTypeOrgIds: [OTHER] },
        { slug: "mixed", parentSlug: null, eventTypeOrgIds: [ACME, OTHER] },
        { slug: "empty", parentSlug: null, eventTypeOrgIds: [] },
        { slug: "dup", parentSlug: "acme", eventTypeOrgIds: [] },
        { slug: "dup", parentSlug: "other", eventTypeOrgIds: [] },
      ],
    });
    for (const team of ["rivals", "mixed", "empty", "dup", "nope"]) {
      expect(await resolveCustomHost(port, { host: "book.acme.com", team })).toEqual({ ok: false });
    }
  });

  it("never looks up slugs for an inactive host", async () => {
    const port = fakePort({ hosts, users: [{ username: "alice", twOrgId: ACME }] });
    await resolveCustomHost(port, { host: "pending.acme.com", users: ["alice"], team: "acme" });
    expect(port.listUsersByUsername).not.toHaveBeenCalled();
    expect(port.listTeamsBySlug).not.toHaveBeenCalled();
  });
});

describe("createResolveCache", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds positive and negative entries for exactly the TTL", () => {
    vi.useFakeTimers();
    const cache = createResolveCache<{ orgSlug: string } | null>();
    cache.set("a", { orgSlug: "acme" });
    cache.set("b", null);
    vi.advanceTimersByTime(RESOLVE_CACHE_TTL_MS - 1);
    expect(cache.get("a")).toEqual({ orgSlug: "acme" });
    expect(cache.get("b")).toBeNull();
    vi.advanceTimersByTime(1);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });

  it("uses a 60 s TTL and supports clear()", () => {
    expect(RESOLVE_CACHE_TTL_MS).toBe(60_000);
    const cache = createResolveCache<number>();
    cache.set("x", 1);
    cache.clear();
    expect(cache.get("x")).toBeUndefined();
  });
});
