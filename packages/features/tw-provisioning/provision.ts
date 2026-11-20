/**
 * TW-T10 — idempotent org provisioning (CC-14).
 *
 * POST /api/v2/orgs on external_ref: one transaction creates org + owner user + default
 * schedule + 2 default event types (15-min discovery / 30-min demo, provider livekit/Camv)
 * + org API key (raw key returned once). A replay with the same external_ref returns the
 * SAME org (200), re-checks the defaults and fills anything missing (crash-resume), and
 * never returns a key. Two concurrent creates: the loser hits the unique index (P2002) and
 * re-reads. All tw_* writes run in withTwPlatform; user/schedule/event-type rows are stamped
 * with twOrgId.
 */
import { randomUUID } from "node:crypto";
import type { RawCapableTx, TxCapableClient } from "@calcom/prisma/tw-org-context";
import { withTwPlatform } from "@calcom/prisma/tw-org-context";
import { generateOrgKey } from "./keys";

export interface WorkingHours {
  days: number[];
  start: string; // HH:MM
  end: string; // HH:MM
}

export interface ProvisionInput {
  externalRef: string;
  name: string;
  slug?: string;
  planCode?: string;
  owner: { email: string; name?: string; username?: string; timeZone?: string };
  workingHours?: WorkingHours;
}

export const DEFAULT_WORKING_HOURS: WorkingHours = { days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" };
export const DEFAULT_EVENT_TYPES = [
  { slug: "discovery", title: "Discovery call", length: 15 },
  { slug: "demo", title: "Demo", length: 30 },
] as const;
export const ORG_KEY_DEFAULT_SCOPES = [
  "orgs:read",
  "orgs:write",
  "members:write",
  "event-types:write",
  "bookings:read",
  "webhooks:write",
];

export class ProvisionError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "ProvisionError";
  }
}

// Minimal structural tx surface (the Prisma tx satisfies it); keeps generated types out of this API.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
export interface ProvisionTx extends RawCapableTx {
  organization: Any;
  orgApiKey: Any;
  organizationMember: Any;
  user: Any;
  schedule: Any;
  eventType: Any;
}
export type ProvisionClient = TxCapableClient<ProvisionTx>;

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function slugify(s: string): string {
  const v = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");
  return v || "org";
}

/** Validate an untrusted body; returns a clean ProvisionInput or throws ProvisionError(400). */
export function parseProvisionBody(body: unknown): ProvisionInput {
  const bad = (m: string) => new ProvisionError(400, "invalid_request", m);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw bad("body must be a JSON object");
  const b = body as Record<string, unknown>;
  const str = (v: unknown, max = 200) =>
    typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;

  const externalRef = str(b.external_ref, 128);
  if (!externalRef) throw bad("external_ref is required (string, <=128)");
  const name = str(b.name, 120);
  if (!name) throw bad("name is required (string, <=120)");
  let slug: string | undefined;
  if (b.slug !== undefined) {
    const s = str(b.slug, 50);
    if (!s || !SLUG_RE.test(s)) throw bad("slug must be lowercase letters, digits and dashes");
    slug = s;
  }
  const o = b.owner as Record<string, unknown> | undefined;
  if (!o || typeof o !== "object") throw bad("owner is required");
  const email = str(o.email, 254)?.toLowerCase();
  if (!email || !EMAIL_RE.test(email)) throw bad("owner.email must be an email address");
  const owner: ProvisionInput["owner"] = { email };
  if (o.name !== undefined) {
    const n = str(o.name, 120);
    if (!n) throw bad("owner.name must be a non-empty string");
    owner.name = n;
  }
  if (o.username !== undefined) {
    const u = str(o.username, 50);
    if (!u || !SLUG_RE.test(u)) throw bad("owner.username must be lowercase letters, digits and dashes");
    owner.username = u;
  }
  if (o.timezone !== undefined) {
    const tz = str(o.timezone, 64);
    if (!tz) throw bad("owner.timezone must be an IANA zone");
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
    } catch {
      throw bad("owner.timezone must be an IANA zone");
    }
    owner.timeZone = tz;
  }
  let workingHours: WorkingHours | undefined;
  if (b.working_hours !== undefined) {
    const w = b.working_hours as Record<string, unknown>;
    if (!w || typeof w !== "object") throw bad("working_hours must be an object");
    const days = w.days;
    if (
      !Array.isArray(days) ||
      days.length === 0 ||
      !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    )
      throw bad("working_hours.days must be integers 0-6 (0 = Sunday)");
    const start = String(w.start ?? "");
    const end = String(w.end ?? "");
    if (!HHMM.test(start) || !HHMM.test(end) || start >= end)
      throw bad("working_hours.start/end must be HH:MM with start < end");
    workingHours = { days: Array.from(new Set(days as number[])).sort(), start, end };
  }
  const planCode = b.plan_code === undefined ? undefined : (str(b.plan_code, 40) ?? undefined);
  if (b.plan_code !== undefined && !planCode) throw bad("plan_code must be a non-empty string");
  return { externalRef, name, slug, planCode, owner, workingHours };
}

const timeOnly = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

export interface ProvisionedOrg {
  id: string;
  slug: string;
  name: string;
  externalRef: string;
  status: string;
  planCode: string | null;
  owner: { userId: number; email: string; username: string };
  eventTypes: { id: number; slug: string; length: number }[];
}
export interface ProvisionResult {
  created: boolean;
  org: ProvisionedOrg;
  /** Raw org API key; present only on the call that created the org. */
  apiKey?: { id: string; prefix: string; raw: string; scopes: string[] };
}

function isUniqueViolation(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { code?: string }).code === "P2002";
}

async function pickSlug(tx: ProvisionTx, wanted: string, explicit: boolean): Promise<string> {
  if (explicit) {
    if (await tx.organization.findUnique({ where: { slug: wanted }, select: { id: true } }))
      throw new ProvisionError(409, "slug_taken", "slug is already in use");
    return wanted;
  }
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? wanted : `${wanted.slice(0, 41)}-${randomUUID().slice(0, 6)}`;
    if (!(await tx.organization.findUnique({ where: { slug: candidate }, select: { id: true } })))
      return candidate;
  }
  throw new ProvisionError(409, "slug_taken", "could not allocate a slug");
}

/** Fills whatever default resources are missing for an org (create path and crash-resume path). */
async function ensureDefaults(
  tx: ProvisionTx,
  org: { id: string; slug: string },
  input: ProvisionInput,
  ownerUserId: number | null
): Promise<{ userId: number; email: string; username: string; eventTypes: ProvisionedOrg["eventTypes"] }> {
  const email = input.owner.email;
  let user = await tx.user.findFirst({
    where: { twOrgId: org.id, email },
    select: { id: true, email: true, username: true, defaultScheduleId: true },
  });
  if (!user) {
    const existing = await tx.user.findFirst({ where: { email }, select: { id: true } });
    if (existing)
      throw new ProvisionError(409, "owner_email_in_use", "owner.email already belongs to another account");
    const username = input.owner.username ?? slugify(email.split("@")[0]);
    const taken = await tx.user.findFirst({
      where: { username, organizationId: null },
      select: { id: true },
    });
    user = await tx.user.create({
      data: {
        email,
        username: taken ? `${username.slice(0, 41)}-${randomUUID().slice(0, 6)}` : username,
        name: input.owner.name ?? input.name,
        timeZone: input.owner.timeZone ?? "UTC",
        twOrgId: org.id,
        completedOnboarding: true,
        metadata: { defaultConferencingApp: { appSlug: "camv", appLink: "" } },
      },
      select: { id: true, email: true, username: true, defaultScheduleId: true },
    });
  }
  void ownerUserId;
  const member = await tx.organizationMember.findFirst({
    where: { orgId: org.id, userId: user.id },
    select: { id: true },
  });
  if (!member)
    await tx.organizationMember.create({ data: { orgId: org.id, userId: user.id, role: "owner" } });

  let scheduleId: number | null = user.defaultScheduleId;
  if (!scheduleId) {
    const wh = input.workingHours ?? DEFAULT_WORKING_HOURS;
    const sch = await tx.schedule.create({
      data: {
        userId: user.id,
        twOrgId: org.id,
        name: "Working hours",
        timeZone: input.owner.timeZone ?? "UTC",
        availability: {
          create: [
            { userId: user.id, days: wh.days, startTime: timeOnly(wh.start), endTime: timeOnly(wh.end) },
          ],
        },
      },
      select: { id: true },
    });
    scheduleId = sch.id;
    await tx.user.update({ where: { id: user.id }, data: { defaultScheduleId: scheduleId } });
  }

  const eventTypes: ProvisionedOrg["eventTypes"] = [];
  for (const [i, def] of DEFAULT_EVENT_TYPES.map((d, i) => [i, d] as const)) {
    let et = await tx.eventType.findFirst({
      where: { userId: user.id, twOrgId: org.id, slug: def.slug },
      select: { id: true, slug: true, length: true },
    });
    if (!et) {
      et = await tx.eventType.create({
        data: {
          title: def.title,
          slug: def.slug,
          length: def.length,
          position: i,
          userId: user.id,
          twOrgId: org.id,
          scheduleId,
          locations: [{ type: "integrations:camv" }],
          users: { connect: [{ id: user.id }] },
        },
        select: { id: true, slug: true, length: true },
      });
    }
    eventTypes.push(et);
  }
  return { userId: user.id, email: user.email, username: user.username ?? "", eventTypes };
}

function view(
  org: {
    id: string;
    slug: string;
    name: string;
    externalRef: string | null;
    status: string;
    planCode: string | null;
  },
  d: Awaited<ReturnType<typeof ensureDefaults>>
): ProvisionedOrg {
  return {
    id: org.id,
    slug: org.slug,
    name: org.name,
    externalRef: org.externalRef ?? "",
    status: org.status,
    planCode: org.planCode,
    owner: { userId: d.userId, email: d.email, username: d.username },
    eventTypes: d.eventTypes,
  };
}

const ORG_SELECT = {
  id: true,
  slug: true,
  name: true,
  externalRef: true,
  status: true,
  planCode: true,
} as const;

export async function provisionOrg(client: ProvisionClient, input: ProvisionInput): Promise<ProvisionResult> {
  const attempt = () =>
    withTwPlatform(client, `TW-T10 provision ${input.externalRef}`, async (tx) => {
      const existing = await tx.organization.findUnique({
        where: { externalRef: input.externalRef },
        select: ORG_SELECT,
      });
      if (existing) {
        const d = await ensureDefaults(tx, existing, input, null);
        return { created: false, org: view(existing, d) } as ProvisionResult;
      }
      const slug = await pickSlug(tx, input.slug ?? slugify(input.name), input.slug !== undefined);
      const org = await tx.organization.create({
        data: {
          slug,
          name: input.name,
          externalRef: input.externalRef,
          planCode: input.planCode ?? null,
          identityMode: "local",
        },
        select: ORG_SELECT,
      });
      const d = await ensureDefaults(tx, org, input, null);
      const key = generateOrgKey();
      const row = await tx.orgApiKey.create({
        data: { orgId: org.id, prefix: key.prefix, hashedKey: key.hashedKey, scopes: ORG_KEY_DEFAULT_SCOPES },
        select: { id: true },
      });
      return {
        created: true,
        org: view(org, d),
        apiKey: { id: row.id, prefix: key.prefix, raw: key.raw, scopes: ORG_KEY_DEFAULT_SCOPES },
      } as ProvisionResult;
    });

  try {
    return await attempt();
  } catch (e) {
    // Concurrent create on the same external_ref: the loser re-reads and returns the winner's org.
    if (isUniqueViolation(e)) return attempt();
    throw e;
  }
}
