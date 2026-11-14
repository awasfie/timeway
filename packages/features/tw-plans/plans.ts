/**
 * TW-T12 — Timeway plans, entitlements and the Spenai package mapping.
 *
 * Catalog = Bible CM.3 (Free/Pro/Teams/Business); bundle sizes = CM.7. Pure functions, no DB:
 * callers load the org + override inside withTwOrg/withTwPlatform and pass them in.
 * Only the four catalog codes are metered. A NULL or non-catalog plan code (spenai-pilot, WC-TW-14
 * "agency"/"starter" orgs created before this ticket) is UNMETERED until Spenai P2-G assigns a
 * plan: enforcing Free on live orgs that never had a plan would break them. Assigning a plan
 * (PUT /orgs/:id/plan) is what turns metering on for an org.
 */

export const PLAN_CODES = ["free", "pro", "teams", "business"] as const;
export type PlanCode = (typeof PLAN_CODES)[number];
export type VideoProvider = "camv" | "google_meet" | "custom_url" | "zoom";

export interface Entitlements {
  /** null = unlimited. For seat-priced plans this is the seats bought (override.seats). */
  maxMembers: number | null;
  maxEventTypes: number | null;
  /** CM.3 sets no booking cap on any tier; kept so the gate exists when one is set. */
  maxBookingsPerMonth: number | null;
  providers: VideoProvider[];
  customDomain: boolean;
  teamScheduling: boolean;
  orgApiKeys: boolean;
}

export const PLAN_ENTITLEMENTS: Record<PlanCode, Entitlements> = {
  free: {
    maxMembers: 1,
    maxEventTypes: 2,
    maxBookingsPerMonth: null,
    providers: ["camv"],
    customDomain: false,
    teamScheduling: false,
    orgApiKeys: false,
  },
  pro: {
    maxMembers: null,
    maxEventTypes: null,
    maxBookingsPerMonth: null,
    providers: ["camv", "google_meet", "custom_url"],
    customDomain: false,
    teamScheduling: false,
    orgApiKeys: false,
  },
  teams: {
    maxMembers: null,
    maxEventTypes: null,
    maxBookingsPerMonth: null,
    providers: ["camv", "google_meet", "custom_url", "zoom"],
    customDomain: false,
    teamScheduling: true,
    orgApiKeys: true,
  },
  business: {
    maxMembers: null,
    maxEventTypes: null,
    maxBookingsPerMonth: null,
    providers: ["camv", "google_meet", "custom_url", "zoom"],
    customDomain: true,
    teamScheduling: true,
    orgApiKeys: true,
  },
};

/** CM.7: Spenai package -> bundled Timeway plan + seats. Enterprise is custom (no automatic mapping). */
export const SPENAI_PACKAGE_MAP = {
  starter: { planCode: "teams", seats: 3 },
  growth: { planCode: "business", seats: 10 },
  scale: { planCode: "business", seats: 30 },
} as const satisfies Record<string, { planCode: PlanCode; seats: number }>;
export type SpenaiPackage = keyof typeof SPENAI_PACKAGE_MAP;

/** CM.7 rule: cancelling Spenai downgrades Timeway to Free, never deletes. */
export const SPENAI_CANCELLED = { planCode: "free", seats: null } as const;

export function isSpenaiPackage(v: unknown): v is SpenaiPackage {
  return typeof v === "string" && Object.hasOwn(SPENAI_PACKAGE_MAP, v);
}

export const UNMETERED: Entitlements = {
  maxMembers: null,
  maxEventTypes: null,
  maxBookingsPerMonth: null,
  providers: ["camv", "google_meet", "custom_url", "zoom"],
  customDomain: true,
  teamScheduling: true,
  orgApiKeys: true,
};

export function normalizePlanCode(code: string | null | undefined): PlanCode | null {
  const c = (code ?? "").toLowerCase();
  return (PLAN_CODES as readonly string[]).includes(c) ? (c as PlanCode) : null;
}

export interface EntitlementOverride {
  seats?: number | null;
  overrides?: Partial<Entitlements> | null;
}

export function effectiveEntitlements(
  planCode: string | null | undefined,
  override?: EntitlementOverride | null
): Entitlements {
  const code = normalizePlanCode(planCode);
  const base = code ? PLAN_ENTITLEMENTS[code] : UNMETERED;
  const merged: Entitlements = { ...base, providers: [...base.providers], ...(override?.overrides ?? {}) };
  if (typeof override?.seats === "number" && override.seats >= 1) merged.maxMembers = override.seats;
  return merged;
}

export type GateResult = { ok: true } | { ok: false; code: string; message: string };
const OK: GateResult = { ok: true };
const deny = (code: string, message: string): GateResult => ({ ok: false, code, message });

const under = (limit: number | null, current: number) => limit === null || current < limit;

/** `current` = rows that exist now; the gate answers "may one more be created?". */
export const canAddMember = (e: Entitlements, current: number): GateResult =>
  under(e.maxMembers, current)
    ? OK
    : deny("plan_limit_members", `plan allows ${e.maxMembers} member(s); upgrade or add seats`);
export const canAddEventType = (e: Entitlements, current: number): GateResult =>
  under(e.maxEventTypes, current)
    ? OK
    : deny("plan_limit_event_types", `plan allows ${e.maxEventTypes} event type(s); upgrade the plan`);
export const canAddBooking = (e: Entitlements, thisMonth: number): GateResult =>
  under(e.maxBookingsPerMonth, thisMonth)
    ? OK
    : deny("plan_limit_bookings", `plan allows ${e.maxBookingsPerMonth} booking(s) per month`);
export const canUseProvider = (e: Entitlements, p: VideoProvider): GateResult =>
  e.providers.includes(p) ? OK : deny("plan_provider_not_allowed", `provider ${p} is not on this plan`);
export const canUseCustomDomain = (e: Entitlements): GateResult =>
  e.customDomain ? OK : deny("plan_custom_domain", "custom domain needs the Business plan");

export interface OrgUsage {
  members: number;
  eventTypes: number;
}
/** Nightly reconciler core: which limits an org is over. Reports only; it never deletes anything. */
export function reconcileUsage(e: Entitlements, u: OrgUsage): string[] {
  const over: string[] = [];
  if (e.maxMembers !== null && u.members > e.maxMembers) over.push("members");
  if (e.maxEventTypes !== null && u.eventTypes > e.maxEventTypes) over.push("event_types");
  return over;
}
