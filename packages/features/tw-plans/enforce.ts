/**
 * TW-T12 — DB-facing plan gates. Run inside the caller's withTwOrg / withTwPlatform transaction so
 * the forced-RLS tables resolve; an org that is not visible resolves to Free (fail closed).
 */
import {
  canAddEventType,
  canAddMember,
  type EntitlementOverride,
  type Entitlements,
  effectiveEntitlements,
  type GateResult,
  type OrgUsage,
  reconcileUsage,
} from "./plans";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export async function loadEntitlements(tx: Any, orgId: string): Promise<Entitlements> {
  const org: { planCode: string | null } | null = await tx.organization.findUnique({
    where: { id: orgId },
    select: { planCode: true },
  });
  const ov: EntitlementOverride | null = await tx.orgEntitlementOverride.findUnique({
    where: { orgId },
    select: { seats: true, overrides: true },
  });
  return effectiveEntitlements(org?.planCode, ov);
}

export async function gateMember(tx: Any, orgId: string): Promise<GateResult> {
  const e = await loadEntitlements(tx, orgId);
  return canAddMember(e, await tx.organizationMember.count({ where: { orgId } }));
}

export async function gateEventType(tx: Any, orgId: string): Promise<GateResult> {
  const e = await loadEntitlements(tx, orgId);
  return canAddEventType(e, await tx.eventType.count({ where: { twOrgId: orgId } }));
}

export async function orgUsage(tx: Any, orgId: string): Promise<OrgUsage> {
  return {
    members: await tx.organizationMember.count({ where: { orgId } }),
    eventTypes: await tx.eventType.count({ where: { twOrgId: orgId } }),
  };
}

/** One org's reconcile pass: returns the limits it is over (never mutates, never deletes). */
export async function reconcileOrg(tx: Any, orgId: string): Promise<{ orgId: string; over: string[] }> {
  const e = await loadEntitlements(tx, orgId);
  return { orgId, over: reconcileUsage(e, await orgUsage(tx, orgId)) };
}
