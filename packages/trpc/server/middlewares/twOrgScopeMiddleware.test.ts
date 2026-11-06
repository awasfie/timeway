import { getTwOrgContext } from "@calcom/prisma/tw-org-context";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const getToken = vi.fn();
vi.mock("next-auth/jwt", () => ({ getToken: (...args: unknown[]) => getToken(...args) }));

import { createCallerFactory, procedure, router } from "../trpc";
import { twOrgScope } from "./twOrgScopeMiddleware";

const ORG = "6f1c2b1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const OTHER_ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const testRouter = router({
  whoami: procedure
    .input(z.object({ twOrgId: z.string().optional() }).optional())
    .query(async () => getTwOrgContext() ?? null),
});
const createCaller = createCallerFactory(testRouter);
const callerFor = (ctx: Record<string, unknown>) => createCaller(ctx as never);

describe("TW-T9.2b1 tRPC org scope middleware", () => {
  beforeEach(() => getToken.mockReset());

  it("runs the base procedure in the org from ctx.session", async () => {
    const caller = callerFor({ session: { user: { id: 1, twOrgId: ORG } } });
    expect(await caller.whoami()).toEqual({ kind: "org", orgId: ORG });
  });

  it("ignores an org named in the procedure input", async () => {
    const caller = callerFor({ session: { user: { id: 1, twOrgId: ORG } } });
    expect(await caller.whoami({ twOrgId: OTHER_ORG })).toEqual({ kind: "org", orgId: ORG });
  });

  it("opens no scope when the session's twOrgId is NULL, even if input names one", async () => {
    getToken.mockResolvedValue({ sub: "1", twOrgId: null });
    const caller = callerFor({ session: { user: { id: 1, twOrgId: null } }, req: { headers: {} } });
    expect(await caller.whoami({ twOrgId: OTHER_ORG })).toBeNull();
  });

  it("falls back to the signed session cookie when ctx has no session yet", async () => {
    getToken.mockResolvedValue({ sub: "1", twOrgId: ORG });
    const caller = callerFor({
      req: { headers: { "x-tw-org-id": OTHER_ORG }, query: { twOrgId: OTHER_ORG } },
    });
    expect(await caller.whoami()).toEqual({ kind: "org", orgId: ORG });
  });

  it("is unscoped for an anonymous caller", async () => {
    getToken.mockResolvedValue(null);
    expect(await callerFor({ req: { headers: {} } }).whoami()).toBeNull();
  });

  it("twOrgScope wraps next() itself", async () => {
    const next = vi.fn(async () => getTwOrgContext());
    expect(await twOrgScope({ ctx: { session: { user: { twOrgId: ORG } } }, next })).toEqual({
      kind: "org",
      orgId: ORG,
    });
  });
});
