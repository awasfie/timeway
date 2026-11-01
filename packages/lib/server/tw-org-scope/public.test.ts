import { getTwOrgContext } from "@calcom/prisma/tw-org-context";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "../../http-error";
import {
  publicLookupForEventTypeIds,
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

  it("booking uid: tries the booking resolver, then the seat resolver; no plain BookingSeat read", async () => {
    expect(publicLookupsForBookingUid("bk1")).toEqual([
      { resolver: "booking_uid", keys: ["bk1"] },
      { resolver: "seat_reference", keys: ["bk1"] },
    ]);
    expect(publicLookupsForBookingUid("")).toEqual([]);
    expect(publicLookupsForBookingUid(null)).toEqual([]);

    const { client, calls } = fakeClient({ "tw_resolve_org_for_booking_uid:bk1": [{ id: 9, twOrgId: ORG }] });
    const seen = await runSsrWithPublicTwOrg(client, publicLookupsForBookingUid("bk1"), () =>
      getTwOrgContext()
    );
    expect(seen).toEqual({ kind: "org", orgId: ORG });
    expect(calls.map((c) => c.fn)).toEqual(["tw_resolve_org_for_booking_uid"]);
  });
});

describe("TW-T9.2b2f seat reference resolver", () => {
  const lookup = { resolver: "seat_reference", keys: ["seat1"] } as const;

  it("one org: the seat link runs in its booking's org via tw_resolve_org_for_seat_reference", async () => {
    const { client, calls } = fakeClient({
      "tw_resolve_org_for_seat_reference:seat1": [{ id: 31, twOrgId: ORG }],
    });
    const seen = await runSsrWithPublicTwOrg(client, publicLookupsForBookingUid("seat1"), () =>
      getTwOrgContext()
    );
    expect(seen).toEqual({ kind: "org", orgId: ORG });
    expect(calls).toEqual([
      { fn: "tw_resolve_org_for_booking_uid", key: "seat1" },
      { fn: "tw_resolve_org_for_seat_reference", key: "seat1" },
    ]);
  });

  it("zero rows: notFound, fn never runs", async () => {
    const { client } = fakeClient({});
    const fn = vi.fn();
    expect(await runSsrWithPublicTwOrg(client, publicLookupsForBookingUid("seat1"), fn)).toEqual({
      notFound: true,
    });
    expect(fn).not.toHaveBeenCalled();
  });

  it("NULL org (booking not backfilled): not found, no platform fallback", async () => {
    const { client } = fakeClient({ "tw_resolve_org_for_seat_reference:seat1": [{ id: 31, twOrgId: null }] });
    expect(await resolvePublicTwOrg(client, lookup)).toBeNull();
  });

  it("two orgs: not found", async () => {
    const { client } = fakeClient({
      "tw_resolve_org_for_seat_reference:seat1": [
        { id: 31, twOrgId: ORG },
        { id: 31, twOrgId: OTHER_ORG },
      ],
    });
    expect(await resolvePublicTwOrg(client, lookup)).toBeNull();
  });
});

describe("TW-T9.2b2f event type id resolver", () => {
  it("one org: resolves through tw_resolve_org_for_event_type_id with an int key", async () => {
    const { client, calls } = fakeClient({
      "tw_resolve_org_for_event_type_id:42": [{ id: 42, twOrgId: ORG }],
    });
    const seen = await runWithPublicTwOrg(client, publicLookupForEventTypeIds([42]), () => getTwOrgContext());
    expect(seen).toEqual({ kind: "org", orgId: ORG });
    expect(calls).toEqual([{ fn: "tw_resolve_org_for_event_type_id", key: 42 }]);
  });

  it("zero rows: 404 and fn never runs; no id: no query at all", async () => {
    const { client, calls } = fakeClient({});
    const fn = vi.fn();
    await expect(runWithPublicTwOrg(client, publicLookupForEventTypeIds([42]), fn)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(publicLookupForEventTypeIds([])).toBeNull();
    expect(publicLookupForEventTypeIds([null, undefined, 1.5])).toBeNull();
    await expect(runWithPublicTwOrg(client, publicLookupForEventTypeIds([]), fn)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(calls).toHaveLength(1);
    expect(fn).not.toHaveBeenCalled();
  });

  it("NULL org: not found", async () => {
    const { client } = fakeClient({ "tw_resolve_org_for_event_type_id:42": [{ id: 42, twOrgId: null }] });
    expect(await resolvePublicTwOrg(client, publicLookupForEventTypeIds([42]))).toBeNull();
  });

  it("two orgs (a reservation spanning event types of two orgs): not found; same org: resolves", async () => {
    const { client } = fakeClient({
      "tw_resolve_org_for_event_type_id:1": [{ id: 1, twOrgId: ORG }],
      "tw_resolve_org_for_event_type_id:2": [{ id: 2, twOrgId: OTHER_ORG }],
      "tw_resolve_org_for_event_type_id:3": [{ id: 3, twOrgId: ORG }],
    });
    expect(await resolvePublicTwOrg(client, publicLookupForEventTypeIds([1, 2]))).toBeNull();
    expect(await resolvePublicTwOrg(client, publicLookupForEventTypeIds([1, 3]))).toBe(ORG);
  });

  it("a non-int32 key never reaches SQL", async () => {
    const { client, calls } = fakeClient({});
    for (const key of ["0", "-1", "1e3", "2147483648", "1; drop"]) {
      expect(await resolvePublicTwOrg(client, { resolver: "event_type_id", keys: [key] })).toBeNull();
    }
    expect(calls).toEqual([]);
  });
});
