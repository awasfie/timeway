import { getTwOrgContext } from "@calcom/prisma/tw-org-context";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../../http-error";
import {
  publicLookupForSchedule,
  publicLookupsForBookingBody,
  publicLookupsForBookingUid,
  resolvePublicTwOrg,
  runSsrWithPublicTwOrg,
  runWithPublicTwOrg,
} from "./public";

const ORG = "6f1c2b1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const OTHER_ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

type Row = { id: number; twOrgId: string | null };

/** Fake client: rows per (function, key); records which definer function each call hit. */
function fakeClient(table: Record<string, Row[]>) {
  const calls: { fn: string; key: unknown }[] = [];
  const client = {
    $queryRaw: vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const fn = /public\.(tw_resolve_org_for_\w+)\(/.exec(strings.join("?"))?.[1] ?? "?";
      calls.push({ fn, key: values[0] });
      return table[`${fn}:${String(values[0])}`] ?? [];
    }),
  };
  return { client, calls };
}

describe("TW-T9.2b2 public org scope", () => {
  beforeEach(() => vi.clearAllMocks());

  it("one org: resolves it through the definer function and runs fn in that scope", async () => {
    const { client, calls } = fakeClient({ "tw_resolve_org_for_user_slug:alice": [{ id: 1, twOrgId: ORG }] });
    const seen = await runWithPublicTwOrg(client, { resolver: "user_slug", keys: ["alice"] }, () =>
      getTwOrgContext()
    );
    expect(seen).toEqual({ kind: "org", orgId: ORG });
    expect(calls).toEqual([{ fn: "tw_resolve_org_for_user_slug", key: "alice" }]);
  });

  it("team slug with several member rows of one org resolves; booking uid uses its own function", async () => {
    const { client, calls } = fakeClient({
      "tw_resolve_org_for_team_slug:sales": [
        { id: 7, twOrgId: ORG },
        { id: 7, twOrgId: ORG.toUpperCase() },
      ],
      "tw_resolve_org_for_booking_uid:bk1": [{ id: 9, twOrgId: ORG }],
    });
    expect(await resolvePublicTwOrg(client, { resolver: "team_slug", keys: ["sales"] })).toBe(ORG);
    expect(await resolvePublicTwOrg(client, { resolver: "booking_uid", keys: ["bk1"] })).toBe(ORG);
    expect(calls.map((c) => c.fn)).toEqual([
      "tw_resolve_org_for_team_slug",
      "tw_resolve_org_for_booking_uid",
    ]);
  });

  it("zero rows: not found (404 for API routes, notFound for SSR), fn never runs", async () => {
    const { client } = fakeClient({});
    const fn = vi.fn();
    await expect(
      runWithPublicTwOrg(client, { resolver: "user_slug", keys: ["ghost"] }, fn)
    ).rejects.toMatchObject({
      statusCode: 404,
    });
    await expect(
      runWithPublicTwOrg(client, { resolver: "user_slug", keys: ["ghost"] }, fn)
    ).rejects.toBeInstanceOf(HttpError);
    expect(await runSsrWithPublicTwOrg(client, { resolver: "user_slug", keys: ["ghost"] }, fn)).toEqual({
      notFound: true,
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("NULL-only org: not found, no platform fallback", async () => {
    const { client } = fakeClient({ "tw_resolve_org_for_user_slug:legacy": [{ id: 2, twOrgId: null }] });
    const fn = vi.fn(() => getTwOrgContext());
    expect(await runSsrWithPublicTwOrg(client, { resolver: "user_slug", keys: ["legacy"] }, fn)).toEqual({
      notFound: true,
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("two orgs behind one key, or a dynamic group spanning two orgs: not found", async () => {
    const { client } = fakeClient({
      "tw_resolve_org_for_team_slug:split": [
        { id: 3, twOrgId: ORG },
        { id: 3, twOrgId: OTHER_ORG },
      ],
      "tw_resolve_org_for_user_slug:alice": [{ id: 1, twOrgId: ORG }],
      "tw_resolve_org_for_user_slug:bob": [{ id: 4, twOrgId: OTHER_ORG }],
      "tw_resolve_org_for_user_slug:carol": [{ id: 5, twOrgId: ORG }],
    });
    expect(await resolvePublicTwOrg(client, { resolver: "team_slug", keys: ["split"] })).toBeNull();
    expect(await resolvePublicTwOrg(client, { resolver: "user_slug", keys: ["alice", "bob"] })).toBeNull();
    expect(await resolvePublicTwOrg(client, { resolver: "user_slug", keys: ["alice", "carol"] })).toBe(ORG);
  });

  it("orgId / orgSlug params are ignored: only user/team keys reach the resolver", async () => {
    const { client, calls } = fakeClient({ "tw_resolve_org_for_user_slug:alice": [{ id: 1, twOrgId: ORG }] });
    const body = { user: "alice", orgSlug: "other-org", orgId: OTHER_ORG, eventTypeId: 1 };
    const seen = await runWithPublicTwOrg(client, publicLookupsForBookingBody(body), () => getTwOrgContext());
    expect(seen).toEqual({ kind: "org", orgId: ORG });
    expect(calls.map((c) => c.key)).toEqual(["alice"]);

    const schedule = publicLookupForSchedule({ usernameList: ["alice"], isTeamEvent: false });
    expect(schedule).toEqual({ resolver: "user_slug", keys: ["alice"] });

    const noKeys = fakeClient({});
    const fn = vi.fn();
    await expect(
      runWithPublicTwOrg(noKeys.client, publicLookupsForBookingBody({ orgId: ORG, orgSlug: "x" }), fn)
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(noKeys.calls).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("booking body: dynamic group 'a+b' checks both users; a single key falls back to the team resolver", async () => {
    expect(publicLookupsForBookingBody({ user: "a+b" })).toEqual([
      { resolver: "user_slug", keys: ["a", "b"] },
    ]);
    const { client, calls } = fakeClient({ "tw_resolve_org_for_team_slug:sales": [{ id: 7, twOrgId: ORG }] });
    const seen = await runWithPublicTwOrg(client, publicLookupsForBookingBody({ user: "sales" }), () =>
      getTwOrgContext()
    );
    expect(seen).toEqual({ kind: "org", orgId: ORG });
    expect(calls.map((c) => c.fn)).toEqual(["tw_resolve_org_for_user_slug", "tw_resolve_org_for_team_slug"]);
    expect(publicLookupForSchedule({ usernameList: ["sales"], isTeamEvent: true })).toEqual({
      resolver: "team_slug",
      keys: ["sales"],
    });
  });

  it("booking uid: a seat reference adds its booking uid as a second lookup", async () => {
    const seatClient = {
      bookingSeat: {
        findUnique: vi.fn(async ({ where }: { where: { referenceUid: string } }) =>
          where.referenceUid === "seat1" ? { booking: { uid: "bk1" } } : null
        ),
      },
    };
    expect(await publicLookupsForBookingUid(seatClient, "bk1")).toEqual([
      { resolver: "booking_uid", keys: ["bk1"] },
    ]);
    expect(await publicLookupsForBookingUid(seatClient, "seat1")).toEqual([
      { resolver: "booking_uid", keys: ["seat1"] },
      { resolver: "booking_uid", keys: ["bk1"] },
    ]);
    expect(await publicLookupsForBookingUid(seatClient, "")).toEqual([]);
  });
});
