import { getTwOrgContext } from "@calcom/prisma/tw-org-context";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { defer, firstValueFrom, lastValueFrom } from "rxjs";
import { API_V2_AUTH_PRINCIPAL_REASON, inAuthPrincipalScope } from "./auth-principal-scope";
import { TwOrgScopeInterceptor, twOrgIdOfAuthUser } from "./tw-org-scope.interceptor";

const ORG = "6f1c2b1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const OTHER_ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

function httpContext(request: Record<string, unknown>): ExecutionContext {
  return {
    getType: () => "http",
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

// The handler resolves after an await, so a scope that only covered subscription would be lost.
const handler: CallHandler = {
  handle: () =>
    defer(async () => {
      await new Promise((r) => setTimeout(r, 1));
      return getTwOrgContext() ?? null;
    }),
};

describe("TW-T9.2b1 TwOrgScopeInterceptor", () => {
  const interceptor = new TwOrgScopeInterceptor();

  it("runs the handler in the verified user's org", async () => {
    const ctx = httpContext({ user: { id: 1, twOrgId: ORG } });
    expect(await firstValueFrom(interceptor.intercept(ctx, handler))).toEqual({ kind: "org", orgId: ORG });
  });

  it("ignores an org in params, query, headers or body", async () => {
    const ctx = httpContext({
      user: { id: 1, twOrgId: ORG },
      params: { twOrgId: OTHER_ORG },
      query: { twOrgId: OTHER_ORG },
      headers: { "x-tw-org-id": OTHER_ORG },
      body: { twOrgId: OTHER_ORG },
    });
    expect(await firstValueFrom(interceptor.intercept(ctx, handler))).toEqual({ kind: "org", orgId: ORG });
  });

  it("opens no scope when the user's twOrgId is NULL, even if the request names an org", async () => {
    const ctx = httpContext({ user: { id: 1, twOrgId: null }, params: { twOrgId: OTHER_ORG } });
    expect(await firstValueFrom(interceptor.intercept(ctx, handler))).toBeNull();
  });

  it("opens no scope for an unauthenticated route", async () => {
    const ctx = httpContext({ headers: { "x-tw-org-id": OTHER_ORG } });
    expect(await firstValueFrom(interceptor.intercept(ctx, handler))).toBeNull();
  });

  it("propagates handler errors", async () => {
    const failing: CallHandler = { handle: () => defer(async () => Promise.reject(new Error("boom"))) };
    const ctx = httpContext({ user: { id: 1, twOrgId: ORG } });
    await expect(lastValueFrom(interceptor.intercept(ctx, failing))).rejects.toThrow("boom");
  });

  it("twOrgIdOfAuthUser rejects non-UUID values", () => {
    expect(twOrgIdOfAuthUser({ twOrgId: "x" })).toBeNull();
    expect(twOrgIdOfAuthUser(undefined)).toBeNull();
    expect(twOrgIdOfAuthUser({ twOrgId: ORG })).toBe(ORG);
  });

  it("principal lookups run in the named platform scope only", async () => {
    expect(await inAuthPrincipalScope(async () => getTwOrgContext())).toEqual({
      kind: "platform",
      reason: API_V2_AUTH_PRINCIPAL_REASON,
    });
    expect(getTwOrgContext()).toBeUndefined();
  });
});
