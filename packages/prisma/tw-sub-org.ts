/**
 * WC-TW-14a — sub-org / billing / sandbox / branding rules for Timeway organizations.
 *
 * Pure functions over the TW-T9 `tw_organization` columns added by
 * 20261019120000_wc_tw_14a_sub_org_columns. No DB access here: callers load the
 * rows inside `withTwPlatform` / `withTwOrg` (tw-org-context.ts) and pass them in,
 * so the rules are testable without Postgres and never widen RLS (decision E2).
 *
 * Decisions (WC-TW-14 split, binding): E1 one level of sub-orgs, E4 branding
 * entitlement via TW_UNBRANDED_PLAN_CODES until TW-T12, E5 billing attribution,
 * E7 sandbox orgs and sub-orgs of a sandbox parent are unbilled.
 */

import process from "node:process";
export type TwBillingAttributionValue = "self" | "parent";

/** The subset of a tw_organization row these rules read. */
export interface TwOrgRuleShape {
  id: string;
  parentOrgId: string | null;
  planCode: string | null;
  billingAttribution: TwBillingAttributionValue;
  isSandbox: boolean;
}

export type TwSubOrgErrorCode =
  | "SUB_ORG_SELF_PARENT"
  | "PARENT_IS_SUB_ORG"
  | "CHILD_HAS_SUB_ORGS"
  | "CHILD_HAS_OTHER_PARENT"
  | "PARENT_MISMATCH"
  | "PARENT_REQUIRED";

export class TwSubOrgError extends Error {
  constructor(
    public readonly code: TwSubOrgErrorCode,
    message: string
  ) {
    super(message);
    this.name = "TwSubOrgError";
  }
}

/** E1: only a top-level org may own sub-orgs. */
export function assertCanHaveSubOrg(org: Pick<TwOrgRuleShape, "id" | "parentOrgId">): void {
  if (org.parentOrgId) {
    throw new TwSubOrgError(
      "PARENT_IS_SUB_ORG",
      `WC-TW-14: org ${org.id} is a sub-org of ${org.parentOrgId} and cannot have sub-orgs (one level only)`
    );
  }
}

/**
 * E1: `child` may sit under `parent` only if the parent is top-level, the child has
 * no sub-orgs of its own, and the child is not already attached to a different parent.
 * `childSubOrgCount` comes from a platform-context count of rows with parentOrgId = child.id.
 */
export function assertCanBeSubOrg(
  child: Pick<TwOrgRuleShape, "id" | "parentOrgId">,
  parent: Pick<TwOrgRuleShape, "id" | "parentOrgId">,
  childSubOrgCount: number
): void {
  if (child.id === parent.id) {
    throw new TwSubOrgError("SUB_ORG_SELF_PARENT", `WC-TW-14: org ${child.id} cannot be its own parent`);
  }
  assertCanHaveSubOrg(parent);
  if (childSubOrgCount > 0) {
    throw new TwSubOrgError(
      "CHILD_HAS_SUB_ORGS",
      `WC-TW-14: org ${child.id} has ${childSubOrgCount} sub-org(s) and cannot become a sub-org (one level only)`
    );
  }
  if (child.parentOrgId && child.parentOrgId !== parent.id) {
    throw new TwSubOrgError(
      "CHILD_HAS_OTHER_PARENT",
      `WC-TW-14: org ${child.id} already belongs to parent ${child.parentOrgId}`
    );
  }
}

/** Callers must hand in the actual parent row whenever parentOrgId is set; anything else is a wiring bug. */
function checkedParent<T extends Pick<TwOrgRuleShape, "id">>(
  org: Pick<TwOrgRuleShape, "id" | "parentOrgId">,
  parent: T | null | undefined
): T | null {
  if (!org.parentOrgId) return null;
  if (!parent) {
    throw new TwSubOrgError(
      "PARENT_REQUIRED",
      `WC-TW-14: org ${org.id} has parent ${org.parentOrgId} but the parent row was not provided`
    );
  }
  if (parent.id !== org.parentOrgId) {
    throw new TwSubOrgError(
      "PARENT_MISMATCH",
      `WC-TW-14: parent row ${parent.id} does not match org ${org.id}.parentOrgId ${org.parentOrgId}`
    );
  }
  return parent;
}

/** E5: the org that is invoiced for `org`'s usage (usage line orgId); clientOrgId stays `org.id`. */
export function resolveBillingOrg(
  org: Pick<TwOrgRuleShape, "id" | "parentOrgId" | "billingAttribution">
): string {
  if (org.billingAttribution === "parent" && org.parentOrgId) return org.parentOrgId;
  return org.id;
}

/** E7: sandbox orgs, and every sub-org of a sandbox parent, emit no usage line. */
export function isUnbilled(
  org: Pick<TwOrgRuleShape, "id" | "parentOrgId" | "isSandbox">,
  parent?: Pick<TwOrgRuleShape, "id" | "isSandbox"> | null
): boolean {
  if (org.isSandbox) return true;
  return checkedParent(org, parent)?.isSandbox ?? false;
}

/** E4: TW_UNBRANDED_PLAN_CODES is a comma list of planCodes; unset or empty means nobody is entitled. */
export function parseUnbrandedPlanCodes(raw: string | undefined | null): ReadonlySet<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

/** E4: entitled when the org's planCode, or its parent's (inherited allowance), is allowlisted. */
export function canHideBranding(
  org: Pick<TwOrgRuleShape, "id" | "parentOrgId" | "planCode">,
  parent?: Pick<TwOrgRuleShape, "id" | "planCode"> | null,
  allowlist: ReadonlySet<string> = parseUnbrandedPlanCodes(process.env.TW_UNBRANDED_PLAN_CODES)
): boolean {
  if (allowlist.size === 0) return false;
  if (org.planCode && allowlist.has(org.planCode)) return true;
  const p = checkedParent(org, parent);
  return Boolean(p?.planCode && allowlist.has(p.planCode));
}
