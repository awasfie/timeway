/**
 * TW-T12 — platform-key plan assignment (the call Spenai P2-G makes: package -> plan).
 * PUT /api/v2/orgs/:orgId/plan  body { spenai_package } | { spenai_cancelled: true } | { plan_code, seats? }
 * Idempotent: same body, same state. In-product Stripe billing for external customers is Phase C.
 */
import { withTwPlatform } from "@calcom/prisma/tw-org-context";
import { isSpenaiPackage, PLAN_CODES, type PlanCode, SPENAI_CANCELLED, SPENAI_PACKAGE_MAP } from "./plans";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

export interface PlanChange {
  planCode: PlanCode;
  seats: number | null;
  source: string;
}

/** Validate an untrusted body; returns the change or an error message. */
export function parsePlanBody(body: unknown): PlanChange | { error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { error: "body must be a JSON object" };
  const b = body as Record<string, unknown>;
  if (b.spenai_cancelled === true) return { ...SPENAI_CANCELLED, source: "spenai:cancelled" };
  if (b.spenai_package !== undefined) {
    if (!isSpenaiPackage(b.spenai_package))
      return { error: `spenai_package must be one of ${Object.keys(SPENAI_PACKAGE_MAP).join(", ")}` };
    const m = SPENAI_PACKAGE_MAP[b.spenai_package];
    return { planCode: m.planCode, seats: m.seats, source: `spenai:${b.spenai_package}` };
  }
  if (typeof b.plan_code !== "string" || !(PLAN_CODES as readonly string[]).includes(b.plan_code))
    return { error: `plan_code must be one of ${PLAN_CODES.join(", ")}` };
  let seats: number | null = null;
  if (b.seats !== undefined) {
    if (typeof b.seats !== "number" || !Number.isInteger(b.seats) || b.seats < 1 || b.seats > 10000)
      return { error: "seats must be an integer 1-10000" };
    seats = b.seats;
  }
  return { planCode: b.plan_code as PlanCode, seats, source: "api" };
}

export async function applyPlan(client: Any, orgId: string, change: PlanChange): Promise<boolean> {
  return withTwPlatform(client, "TW-T12 set plan", async (tx: Any) => {
    const org = await tx.organization.findUnique({ where: { id: orgId }, select: { id: true } });
    if (!org) return false;
    await tx.organization.update({ where: { id: orgId }, data: { planCode: change.planCode } });
    await tx.orgEntitlementOverride.upsert({
      where: { orgId },
      create: { orgId, seats: change.seats, source: change.source },
      update: { seats: change.seats, source: change.source },
    });
    return true;
  });
}
