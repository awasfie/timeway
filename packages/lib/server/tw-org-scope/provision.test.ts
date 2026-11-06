import { describe, expect, it, vi } from "vitest";

vi.mock("@calcom/prisma", () => ({ prisma: {} }));

import { getTwOrgContext } from "@calcom/prisma/tw-org-context";

import {
  ensureUserTwOrg,
  provisionSignedInUser,
  runOrglessLogin,
  runSignupProvision,
  TW_SIGNUP_PLATFORM_REASON,
  TW_USER_ORG_PROVISION_REASON,
} from "./provision";

const ORG = "27eb38bb-0de9-447a-809b-7edd21bbfc78";

function fakeClient(opts: { org?: string | null; principal?: { id: number; twOrgId: string | null } | null }) {
  const calls: string[] = [];
  const tx = {
    $executeRaw: vi.fn(async (q: TemplateStringsArray, ...v: unknown[]) => {
      calls.push(q.join("?") + JSON.stringify(v));
      return 1;
    }),
    $queryRaw: vi.fn(async (q: TemplateStringsArray, ...v: unknown[]) => {
      calls.push(q.join("?") + JSON.stringify(v));
      return [{ twOrgId: opts.org ?? null }];
    }),
  };
  return {
    calls,
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    $queryRaw: vi.fn(async (q: TemplateStringsArray, ...v: unknown[]) => {
      calls.push(q.join("?") + JSON.stringify(v));
      return opts.principal ? [opts.principal] : [];
    }),
  };
}

describe("TW-T9 user org provisioning (t_9824b7a7)", () => {
  it("ensureUserTwOrg calls tw_ensure_user_org inside the provisioning platform scope", async () => {
    const c = fakeClient({ org: ORG });
    expect(await ensureUserTwOrg(9, c)).toBe(ORG);
    const sql = c.calls.join("\n");
    expect(sql).toContain("app.tw_platform");
    expect(sql).toContain("tw_ensure_user_org");
    expect(sql).toContain("[9]");
  });

  it("ensureUserTwOrg returns null for a bad id without touching the DB, and for an unresolved user", async () => {
    const c = fakeClient({ org: null });
    expect(await ensureUserTwOrg(0, c)).toBeNull();
    expect(await ensureUserTwOrg(1.5, c)).toBeNull();
    expect(c.$transaction).not.toHaveBeenCalled();
    expect(await ensureUserTwOrg(10, c)).toBeNull();
  });

  it("runSignupProvision and runOrglessLogin open their named platform scopes only for the call", async () => {
    expect(await runSignupProvision(() => getTwOrgContext())).toEqual({
      kind: "platform",
      reason: TW_SIGNUP_PLATFORM_REASON,
    });
    expect(await runOrglessLogin(() => getTwOrgContext())).toEqual({
      kind: "platform",
      reason: TW_USER_ORG_PROVISION_REASON,
    });
    expect(getTwOrgContext()).toBeUndefined();
  });

  it("provisionSignedInUser finds the row by email and provisions an org-less user", async () => {
    const c = fakeClient({ org: ORG, principal: { id: 10, twOrgId: null } });
    expect(await provisionSignedInUser({ email: "a@example.test" }, undefined, c)).toBe(ORG);
    expect(c.calls.join("\n")).toContain("tw_resolve_user_for_login");
    expect(c.$transaction).toHaveBeenCalledTimes(1);
  });

  it("provisionSignedInUser keeps an existing org and does nothing for an unknown email", async () => {
    const has = fakeClient({ principal: { id: 3, twOrgId: ORG } });
    expect(await provisionSignedInUser({ email: "b@example.test" }, undefined, has)).toBe(ORG);
    expect(has.$transaction).not.toHaveBeenCalled();
    const none = fakeClient({ principal: null });
    expect(await provisionSignedInUser({ email: "c@example.test" }, undefined, none)).toBeNull();
    expect(await provisionSignedInUser({ email: null }, undefined, none)).toBeNull();
    expect(none.$transaction).not.toHaveBeenCalled();
  });
});
