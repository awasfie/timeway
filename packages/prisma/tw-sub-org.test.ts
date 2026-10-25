import { afterEach, describe, expect, it, vi } from "vitest";
import type { TwOrgRuleShape } from "./tw-sub-org";
import {
  assertCanBeSubOrg,
  assertCanHaveSubOrg,
  canHideBranding,
  isUnbilled,
  parseUnbrandedPlanCodes,
  resolveBillingOrg,
  TwSubOrgError,
} from "./tw-sub-org";

const AGENCY = "11111111-1111-4111-8111-111111111111";
const CLIENT = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";

function org(over: Partial<TwOrgRuleShape> & { id: string }): TwOrgRuleShape {
  return { parentOrgId: null, planCode: null, billingAttribution: "self", isSandbox: false, ...over };
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    if (e instanceof TwSubOrgError) return e.code;
    throw e;
  }
  return undefined;
}

describe("E1 one level of sub-orgs", () => {
  it("a top-level org may have sub-orgs; a sub-org may not", () => {
    expect(() => assertCanHaveSubOrg(org({ id: AGENCY }))).not.toThrow();
    expect(codeOf(() => assertCanHaveSubOrg(org({ id: CLIENT, parentOrgId: AGENCY })))).toBe(
      "PARENT_IS_SUB_ORG"
    );
  });

  it("allows a plain top-level org under a top-level parent, and re-asserting the same parent", () => {
    expect(() => assertCanBeSubOrg(org({ id: CLIENT }), org({ id: AGENCY }), 0)).not.toThrow();
    expect(() =>
      assertCanBeSubOrg(org({ id: CLIENT, parentOrgId: AGENCY }), org({ id: AGENCY }), 0)
    ).not.toThrow();
  });

  it("rejects a parent that is itself a sub-org", () => {
    expect(
      codeOf(() => assertCanBeSubOrg(org({ id: OTHER }), org({ id: CLIENT, parentOrgId: AGENCY }), 0))
    ).toBe("PARENT_IS_SUB_ORG");
  });

  it("rejects an org that already has sub-orgs from becoming a sub-org", () => {
    expect(codeOf(() => assertCanBeSubOrg(org({ id: CLIENT }), org({ id: AGENCY }), 1))).toBe(
      "CHILD_HAS_SUB_ORGS"
    );
  });

  it("rejects self-parenting and moving a sub-org to a different parent", () => {
    expect(codeOf(() => assertCanBeSubOrg(org({ id: AGENCY }), org({ id: AGENCY }), 0))).toBe(
      "SUB_ORG_SELF_PARENT"
    );
    expect(
      codeOf(() => assertCanBeSubOrg(org({ id: CLIENT, parentOrgId: OTHER }), org({ id: AGENCY }), 0))
    ).toBe("CHILD_HAS_OTHER_PARENT");
  });
});

describe("E5 resolveBillingOrg", () => {
  it("bills the parent only when attributed to parent AND a parent is set", () => {
    expect(resolveBillingOrg(org({ id: CLIENT, parentOrgId: AGENCY, billingAttribution: "parent" }))).toBe(
      AGENCY
    );
    expect(resolveBillingOrg(org({ id: CLIENT, parentOrgId: AGENCY, billingAttribution: "self" }))).toBe(
      CLIENT
    );
    expect(resolveBillingOrg(org({ id: CLIENT, billingAttribution: "parent" }))).toBe(CLIENT);
    expect(resolveBillingOrg(org({ id: AGENCY }))).toBe(AGENCY);
  });
});

describe("E7 isUnbilled", () => {
  it("sandbox org is unbilled; a normal top-level org is billed", () => {
    expect(isUnbilled(org({ id: AGENCY, isSandbox: true }))).toBe(true);
    expect(isUnbilled(org({ id: AGENCY }))).toBe(false);
  });

  it("a sub-org of a sandbox parent is unbilled even if not itself sandbox", () => {
    const child = org({ id: CLIENT, parentOrgId: AGENCY });
    expect(isUnbilled(child, org({ id: AGENCY, isSandbox: true }))).toBe(true);
    expect(isUnbilled(child, org({ id: AGENCY }))).toBe(false);
  });

  it("fails loudly when a sub-org's parent row is missing or the wrong row", () => {
    const child = org({ id: CLIENT, parentOrgId: AGENCY });
    expect(codeOf(() => isUnbilled(child))).toBe("PARENT_REQUIRED");
    expect(codeOf(() => isUnbilled(child, org({ id: OTHER, isSandbox: true })))).toBe("PARENT_MISMATCH");
  });
});

describe("E4 canHideBranding", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("parses the allowlist; unset or blank means nobody", () => {
    expect([...parseUnbrandedPlanCodes(undefined)]).toEqual([]);
    expect([...parseUnbrandedPlanCodes(" , ")]).toEqual([]);
    expect([...parseUnbrandedPlanCodes(" agency, business ,")]).toEqual(["agency", "business"]);
  });

  it("default env (empty) entitles nobody, even an org with a planCode", () => {
    vi.stubEnv("TW_UNBRANDED_PLAN_CODES", "");
    expect(canHideBranding(org({ id: AGENCY, planCode: "agency" }))).toBe(false);
  });

  it("reads TW_UNBRANDED_PLAN_CODES from the env by default", () => {
    vi.stubEnv("TW_UNBRANDED_PLAN_CODES", "agency");
    expect(canHideBranding(org({ id: AGENCY, planCode: "agency" }))).toBe(true);
    expect(canHideBranding(org({ id: AGENCY, planCode: "starter" }))).toBe(false);
    expect(canHideBranding(org({ id: AGENCY }))).toBe(false);
  });

  it("a sub-org inherits its parent's allowance", () => {
    const allow = parseUnbrandedPlanCodes("agency");
    const child = org({ id: CLIENT, parentOrgId: AGENCY, planCode: null });
    expect(canHideBranding(child, org({ id: AGENCY, planCode: "agency" }), allow)).toBe(true);
    expect(canHideBranding(child, org({ id: AGENCY, planCode: "starter" }), allow)).toBe(false);
    expect(codeOf(() => canHideBranding(child, null, allow))).toBe("PARENT_REQUIRED");
  });

  it("an entitled sub-org does not need its parent row", () => {
    const allow = parseUnbrandedPlanCodes("agency");
    expect(canHideBranding(org({ id: CLIENT, parentOrgId: AGENCY, planCode: "agency" }), null, allow)).toBe(
      true
    );
  });
});
