import { getTwOrgContext } from "@calcom/prisma/tw-org-context";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getToken = vi.fn();
let tokenReadFails = false;
vi.mock("next-auth/jwt", () => ({
  getToken: async (...args: unknown[]) => {
    if (tokenReadFails) throw new Error("bad cookie");
    return getToken(...args);
  },
}));

import {
  readSessionTwOrgId,
  resolveLoginPrincipal,
  runWithSessionTwOrg,
  twOrgIdOf,
  withSessionTwOrg,
} from "./session";

const ORG = "6f1c2b1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const OTHER_ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("TW-T9.2b1 session org scope", () => {
  beforeEach(() => {
    getToken.mockReset();
    tokenReadFails = false;
  });

  it("twOrgIdOf accepts a UUID twOrgId and nothing else", () => {
    expect(twOrgIdOf({ twOrgId: ORG })).toBe(ORG);
    expect(twOrgIdOf({ twOrgId: null })).toBeNull();
    expect(twOrgIdOf({ twOrgId: "not-a-uuid" })).toBeNull();
    expect(twOrgIdOf({ twOrgId: 42 })).toBeNull();
    expect(twOrgIdOf(null)).toBeNull();
  });

  it("opens an org scope when the session carries twOrgId", async () => {
    const seen = await runWithSessionTwOrg(ORG, () => getTwOrgContext());
    expect(seen).toEqual({ kind: "org", orgId: ORG });
    expect(getTwOrgContext()).toBeUndefined();
  });

  it("opens no scope (and no platform fallback) when twOrgId is NULL", async () => {
    expect(await runWithSessionTwOrg(null, () => getTwOrgContext())).toBeUndefined();
    expect(await runWithSessionTwOrg(undefined, () => getTwOrgContext())).toBeUndefined();
  });

  it("withSessionTwOrg takes the org from the signed token, ignoring query, headers and body", async () => {
    getToken.mockResolvedValue({ sub: "7", email: "a@b.co", twOrgId: ORG });
    const req = {
      query: { twOrgId: OTHER_ORG },
      headers: { "x-tw-org-id": OTHER_ORG },
      body: { twOrgId: OTHER_ORG },
    };
    const handler = vi.fn(async (_req: typeof req, extra: string) => ({ ctx: getTwOrgContext(), extra }));
    const out = await withSessionTwOrg(handler)(req, "res");
    expect(out).toEqual({ ctx: { kind: "org", orgId: ORG }, extra: "res" });
    expect(handler).toHaveBeenCalledWith(req, "res");
  });

  it("withSessionTwOrg runs unscoped with no session even if the request names an org", async () => {
    getToken.mockResolvedValue(null);
    const req = { query: { twOrgId: OTHER_ORG }, headers: { "x-tw-org-id": OTHER_ORG } };
    const out = await withSessionTwOrg(async () => getTwOrgContext())(req);
    expect(out).toBeUndefined();
  });

  it("withSessionTwOrg runs unscoped for a session whose twOrgId is NULL", async () => {
    getToken.mockResolvedValue({ sub: "7", email: "a@b.co", twOrgId: null });
    expect(await withSessionTwOrg(async () => getTwOrgContext())({ query: {} })).toBeUndefined();
  });

  it("readSessionTwOrgId fails closed when the token cannot be read", async () => {
    tokenReadFails = true;
    expect(await readSessionTwOrgId({ headers: {} })).toBeNull();
    expect(await readSessionTwOrgId(undefined)).toBeNull();
  });

  it("resolveLoginPrincipal reads only through tw_resolve_user_for_login", async () => {
    const $queryRaw = vi.fn(async (q: TemplateStringsArray) => {
      expect(q.join("?")).toContain("public.tw_resolve_user_for_login(");
      return [{ id: 7, twOrgId: ORG }];
    });
    expect(await resolveLoginPrincipal({ $queryRaw } as never, "a@b.co")).toEqual({ id: 7, twOrgId: ORG });
    expect($queryRaw.mock.calls[0].slice(1)).toEqual(["a@b.co"]);
  });

  it("resolveLoginPrincipal returns a NULL org as null and an unknown email as null", async () => {
    const nullOrg = { $queryRaw: vi.fn(async () => [{ id: 9, twOrgId: null }]) };
    expect(await resolveLoginPrincipal(nullOrg as never, "x@y.co")).toEqual({ id: 9, twOrgId: null });
    const none = { $queryRaw: vi.fn(async () => []) };
    expect(await resolveLoginPrincipal(none as never, "x@y.co")).toBeNull();
    expect(await resolveLoginPrincipal(none as never, "")).toBeNull();
    expect(none.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
