/**
 * TW-T10 — /api/v2/orgs router, framework-free so the CC-14/CC-13 tests drive it directly.
 *
 *   POST   /orgs                              platform master key; idempotent on external_ref
 *   GET    /orgs/{orgId}                      org key (scope orgs:read)
 *   GET    /orgs/{orgId}/branding             orgs:read          (TW-T13)
 *   PUT    /orgs/{orgId}/branding             orgs:write  {logo_url?, brand_color?, dark_brand_color?}
 *   POST   /orgs/{orgId}/sub-orgs             orgs:write  idempotent on client_ref (WC-TW-14b)
 *   GET    /orgs/{orgId}/sub-orgs[/{subId}]   orgs:read   (another parent's sub-org -> 404)
 *   PATCH  /orgs/{orgId}/sub-orgs/{subId}     orgs:write  {hide_branding?, billing_attribution?}
 *   GET    /orgs/{orgId}/members              members:read | members:write
 *   POST   /orgs/{orgId}/members              members:write   (user created managed = true)
 *   GET    /orgs/{orgId}/event-types          event-types:write | orgs:read
 *   POST   /orgs/{orgId}/event-types          event-types:write
 *   GET    /orgs/{orgId}/slots?eventTypeId&start&end&timezone   bookings:read
 *   GET    /orgs/{orgId}/bookings?status&limit                  bookings:read
 *   GET    /orgs/{orgId}/webhooks             webhooks:write
 *   POST   /orgs/{orgId}/webhooks             webhooks:write  {subscriber_url, triggers[], secret?}
 *   DELETE /orgs/{orgId}/webhooks/{id}        webhooks:write
 *
 * The org for every non-create call is the key's org; a path orgId that is not the key's org is
 * 404 (never 403: no existence oracle). Org ids never come from body/query.
 */

import { randomUUID } from "node:crypto";
import { createFixedWindowLimiter } from "@calcom/lib/domainManager/customHostnames/rateLimit";
import { assertTwOrgId, withTwOrg } from "@calcom/prisma/tw-org-context";
import { applyBranding, getOrgBranding, parseBrandingBody } from "../tw-branding/branding";
import { gateEventType, gateMember, loadEntitlements } from "../tw-plans/enforce";
import { applyPlan, parsePlanBody } from "../tw-plans/setPlan";
import type { AuthClient, AuthResult } from "./auth";
import { authenticate, requireScope } from "./auth";
import type { ProvisionClient } from "./provision";
import {
  createSubOrg,
  getSubOrg,
  listSubOrgs,
  parseSubOrgBody,
  parseSubOrgPatch,
  patchSubOrg,
  type SubOrgClient,
} from "./subOrgs";
import { ProvisionError, parseProvisionBody, provisionOrg, slugify } from "./provision";

export interface ApiRequest {
  method: string;
  /** Path segments after /api/v2/orgs, e.g. [] | [orgId] | [orgId, "members"]. */
  path: string[];
  authorization: string | null;
  query: URLSearchParams;
  body: unknown;
}
export interface ApiResponse {
  status: number;
  body: unknown;
}

export type OrgApiClient = ProvisionClient &
  AuthClient & {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $transaction<R>(
      fn: (tx: any) => Promise<R>,
      options?: { timeout?: number; maxWait?: number }
    ): Promise<R>;
  };

export interface OrgApiDeps {
  client: OrgApiClient;
  /** Same function the public booker uses (viewer.slots.getSchedule). */
  getSlots: (input: {
    eventTypeId: number;
    startTime: string;
    endTime: string;
    timeZone: string;
  }) => Promise<unknown>;
  limiter?: (key: string) => boolean;
}

const WEBHOOK_TRIGGERS = [
  "BOOKING_CREATED",
  "BOOKING_RESCHEDULED",
  "BOOKING_CANCELLED",
  "BOOKING_REQUESTED",
  "BOOKING_REJECTED",
  "BOOKING_NO_SHOW_UPDATED",
  "MEETING_STARTED",
  "MEETING_ENDED",
] as const;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BOOKING_STATUSES = ["ACCEPTED", "PENDING", "CANCELLED", "REJECTED", "AWAITING_HOST"];

const json = (status: number, body: unknown): ApiResponse => ({ status, body });
const err = (status: number, code: string, message: string) => json(status, { error: { code, message } });

const defaultLimiter = createFixedWindowLimiter({ limit: 120, windowMs: 60_000 });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;
}
function obj(b: unknown): Record<string, unknown> | null {
  return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
}

export async function handleOrgApi(req: ApiRequest, deps: OrgApiDeps): Promise<ApiResponse> {
  try {
    const auth = await authenticate(deps.client, req.authorization);
    if (auth.kind === "denied") return err(auth.status, "unauthorized", "missing or invalid API key");
    const limiter = deps.limiter ?? defaultLimiter;
    const limitKey = auth.kind === "org" ? `k:${auth.keyId}` : "platform";
    if (!limiter(limitKey)) return err(429, "rate_limited", "too many requests");
    return await route(req, auth, deps);
  } catch (e) {
    if (e instanceof ProvisionError) return err(e.status, e.code, e.message);
    return err(500, "internal", "internal error");
  }
}

async function route(req: ApiRequest, auth: AuthResult, deps: OrgApiDeps): Promise<ApiResponse> {
  const [orgId, sub, subId] = req.path;
  const m = req.method.toUpperCase();

  if (!orgId) {
    if (m !== "POST") return err(405, "method_not_allowed", "use POST /orgs");
    if (auth.kind !== "platform") return err(403, "forbidden", "org creation needs the platform key");
    const input = parseProvisionBody(req.body);
    const r = await provisionOrg(deps.client, input);
    return json(r.created ? 201 : 200, { org: r.org, ...(r.apiKey ? { api_key: r.apiKey } : {}) });
  }

  // TW-T12: plan assignment is the platform key's call (Spenai package -> plan), nothing else.
  if (sub === "plan" && m === "PUT") {
    if (auth.kind !== "platform") return err(403, "forbidden", "plan changes need the platform key");
    try {
      assertTwOrgId(orgId);
    } catch {
      return err(404, "not_found", "organization not found");
    }
    const change = parsePlanBody(req.body);
    if ("error" in change) return err(400, "invalid_request", change.error);
    return (await applyPlan(deps.client, orgId, change))
      ? json(200, { plan: { plan_code: change.planCode, seats: change.seats } })
      : err(404, "not_found", "organization not found");
  }

  // Everything below is org-scoped and never available to the platform key.
  if (auth.kind !== "org") return err(403, "forbidden", "use the organization API key");
  try {
    assertTwOrgId(orgId);
  } catch {
    return err(404, "not_found", "organization not found");
  }
  if (orgId !== auth.orgId) return err(404, "not_found", "organization not found");
  const need = (scope: string, alt?: string) =>
    requireScope(auth, scope) || (alt !== undefined && requireScope(auth, alt));

  if (!sub) {
    if (m !== "GET") return err(405, "method_not_allowed", "use GET");
    if (!need("orgs:read")) return err(403, "forbidden", "scope orgs:read required");
    const org = await withTwOrg(deps.client, orgId, (tx: Any) =>
      tx.organization.findUnique({
        where: { id: orgId },
        select: {
          id: true,
          slug: true,
          name: true,
          externalRef: true,
          status: true,
          planCode: true,
          createdAt: true,
        },
      })
    );
    return org ? json(200, { org }) : err(404, "not_found", "organization not found");
  }

  switch (sub) {
    case "branding":
      return branding(req, m, orgId, deps, need);
    case "plan":
      return plan(req, m, orgId, deps, need);
    case "sub-orgs":
      return subOrgs(req, m, orgId, subId, deps, need);
    case "members":
      return members(req, m, orgId, deps, need);
    case "event-types":
      return eventTypes(req, m, orgId, deps, need);
    case "slots":
      return slots(req, m, orgId, deps, need);
    case "bookings":
      return bookings(req, m, orgId, deps, need);
    case "webhooks":
      return webhooks(req, m, orgId, subId, deps, need);
    default:
      return err(404, "not_found", "unknown resource");
  }
}

type Need = (scope: string, alt?: string) => boolean;

async function plan(
  req: ApiRequest,
  m: string,
  orgId: string,
  deps: OrgApiDeps,
  need: Need
): Promise<ApiResponse> {
  if (m !== "GET") return err(405, "method_not_allowed", "use GET");
  if (!need("orgs:read")) return err(403, "forbidden", "scope orgs:read required");
  return withTwOrg(deps.client, orgId, async (tx: Any) => {
    const org = await tx.organization.findUnique({ where: { id: orgId }, select: { planCode: true } });
    return json(200, {
      plan: { plan_code: org?.planCode ?? null, entitlements: await loadEntitlements(tx, orgId) },
    });
  });
}

async function subOrgs(
  req: ApiRequest,
  m: string,
  orgId: string,
  subId: string | undefined,
  deps: OrgApiDeps,
  need: Need
): Promise<ApiResponse> {
  const client = deps.client as unknown as SubOrgClient;
  const notFound = () => err(404, "not_found", "sub-organization not found");
  if (!subId) {
    if (m === "GET") {
      if (!need("orgs:read"))
        return err(403, "forbidden", "scope orgs:read required");
      return json(200, { sub_orgs: await listSubOrgs(client, orgId) });
    }
    if (m !== "POST") return err(405, "method_not_allowed", "use GET or POST");
    if (!need("orgs:write"))
      return err(403, "forbidden", "scope orgs:write required");
    const r = await createSubOrg(client, orgId, parseSubOrgBody(req.body));
    return json(r.created ? 201 : 200, { sub_org: r.org });
  }
  if (m === "GET") {
    if (!need("orgs:read"))
      return err(403, "forbidden", "scope orgs:read required");
    const o = await getSubOrg(client, orgId, subId);
    return o ? json(200, { sub_org: o }) : notFound();
  }
  if (m === "PATCH") {
    if (!need("orgs:write"))
      return err(403, "forbidden", "scope orgs:write required");
    const o = await patchSubOrg(
      client,
      orgId,
      subId,
      parseSubOrgPatch(req.body)
    );
    return o ? json(200, { sub_org: o }) : notFound();
  }
  return err(405, "method_not_allowed", "use GET or PATCH");
}

async function branding(
  req: ApiRequest,
  m: string,
  orgId: string,
  deps: OrgApiDeps,
  need: Need
): Promise<ApiResponse> {
  const view = (b: Awaited<ReturnType<typeof getOrgBranding>>) =>
    b
      ? json(200, {
          branding: {
            logo_url: b.logoUrl,
            brand_color: b.brandColor,
            dark_brand_color: b.darkBrandColor,
          },
        })
      : err(404, "not_found", "organization not found");
  if (m === "GET") {
    if (!need("orgs:read")) return err(403, "forbidden", "scope orgs:read required");
    return view(await getOrgBranding(deps.client, orgId));
  }
  if (m === "PUT") {
    if (!need("orgs:write")) return err(403, "forbidden", "scope orgs:write required");
    const change = parseBrandingBody(req.body);
    if ("error" in change) return err(400, "invalid_request", change.error);
    return view(await applyBranding(deps.client, orgId, change));
  }
  return err(405, "method_not_allowed", "use GET or PUT");
}

async function members(
  req: ApiRequest,
  m: string,
  orgId: string,
  deps: OrgApiDeps,
  need: Need
): Promise<ApiResponse> {
  if (m === "GET") {
    if (!need("members:write", "orgs:read")) return err(403, "forbidden", "scope members:read required");
    const rows = await withTwOrg(deps.client, orgId, (tx: Any) =>
      tx.organizationMember.findMany({
        where: { orgId },
        select: {
          role: true,
          managed: true,
          createdAt: true,
          user: { select: { id: true, email: true, username: true, name: true } },
        },
        orderBy: { createdAt: "asc" },
        take: 500,
      })
    );
    return json(200, { members: rows });
  }
  if (m !== "POST") return err(405, "method_not_allowed", "use GET or POST");
  if (!need("members:write")) return err(403, "forbidden", "scope members:write required");
  const b = obj(req.body);
  const email = b && str(b.email, 254)?.toLowerCase();
  if (!b || !email || !EMAIL_RE.test(email)) return err(400, "invalid_request", "email is required");
  const role = b.role === undefined ? "member" : b.role;
  if (role !== "member" && role !== "admin")
    return err(400, "invalid_request", "role must be member or admin");
  const name = b.name === undefined ? email.split("@")[0] : str(b.name, 120);
  if (!name) return err(400, "invalid_request", "name must be a non-empty string");
  const username = b.username === undefined ? slugify(email.split("@")[0]) : str(b.username, 50);
  if (!username || !SLUG_RE.test(username))
    return err(400, "invalid_request", "username must be lowercase letters, digits and dashes");

  return withTwOrg(deps.client, orgId, async (tx: Any) => {
    const existing = await tx.user.findFirst({
      where: { email },
      select: { id: true, twOrgId: true, username: true },
    });
    if (existing && existing.twOrgId !== orgId)
      return err(409, "email_in_use", "email already belongs to another account");
    // Gate before any write: an early err() return does not roll the transaction back.
    const already = existing
      ? await tx.organizationMember.findFirst({ where: { orgId, userId: existing.id }, select: { id: true } })
      : null;
    if (!already) {
      const gate = await gateMember(tx, orgId);
      if (!gate.ok) return err(402, gate.code, gate.message);
    }
    let user = existing;
    let created = false;
    if (!user) {
      const taken = await tx.user.findFirst({
        where: { username, organizationId: null },
        select: { id: true },
      });
      user = await tx.user.create({
        data: {
          email,
          username: taken ? `${username.slice(0, 41)}-${randomUUID().slice(0, 6)}` : username,
          name,
          twOrgId: orgId,
          completedOnboarding: true,
        },
        select: { id: true, twOrgId: true, username: true },
      });
      created = true;
    }
    const member = await tx.organizationMember.findFirst({
      where: { orgId, userId: user.id },
      select: { id: true, role: true },
    });
    if (!member)
      await tx.organizationMember.create({ data: { orgId, userId: user.id, role, managed: true } });
    return json(created || !member ? 201 : 200, {
      member: { userId: user.id, email, username: user.username, role: member?.role ?? role },
    });
  });
}

async function eventTypes(
  req: ApiRequest,
  m: string,
  orgId: string,
  deps: OrgApiDeps,
  need: Need
): Promise<ApiResponse> {
  if (m === "GET") {
    if (!need("event-types:write", "orgs:read")) return err(403, "forbidden", "scope orgs:read required");
    const rows = await deps.client.$transaction((tx: Any) =>
      tx.eventType.findMany({
        where: { twOrgId: orgId },
        select: { id: true, slug: true, title: true, length: true, userId: true, hidden: true },
        orderBy: { id: "asc" },
        take: 500,
      })
    );
    return json(200, { event_types: rows });
  }
  if (m !== "POST") return err(405, "method_not_allowed", "use GET or POST");
  if (!need("event-types:write")) return err(403, "forbidden", "scope event-types:write required");
  const b = obj(req.body);
  const title = b && str(b.title, 120);
  const slug = b && str(b.slug, 50);
  const length = b?.length;
  if (!b || !title || !slug || !SLUG_RE.test(slug))
    return err(400, "invalid_request", "title and slug are required");
  if (typeof length !== "number" || !Number.isInteger(length) || length < 5 || length > 720)
    return err(400, "invalid_request", "length must be an integer number of minutes, 5-720");
  let ownerUserId: number | null = null;
  if (b.owner_user_id !== undefined) {
    if (typeof b.owner_user_id !== "number" || !Number.isInteger(b.owner_user_id))
      return err(400, "invalid_request", "owner_user_id must be an integer");
    ownerUserId = b.owner_user_id;
  }
  return withTwOrg(deps.client, orgId, async (tx: Any) => {
    const owner = ownerUserId
      ? await tx.organizationMember.findFirst({
          where: { orgId, userId: ownerUserId },
          select: { userId: true },
        })
      : await tx.organizationMember.findFirst({ where: { orgId, role: "owner" }, select: { userId: true } });
    if (!owner) return err(404, "not_found", "member not found in this organization");
    const user = await tx.user.findFirst({
      where: { id: owner.userId, twOrgId: orgId },
      select: { id: true, defaultScheduleId: true },
    });
    if (!user) return err(404, "not_found", "member not found in this organization");
    const dup = await tx.eventType.findFirst({ where: { userId: user.id, slug }, select: { id: true } });
    if (dup) return err(409, "slug_taken", "event type slug already exists for this member");
    const gate = await gateEventType(tx, orgId);
    if (!gate.ok) return err(402, gate.code, gate.message);
    const et = await tx.eventType.create({
      data: {
        title,
        slug,
        length,
        userId: user.id,
        twOrgId: orgId,
        scheduleId: user.defaultScheduleId,
        locations: [{ type: "integrations:camv" }],
        users: { connect: [{ id: user.id }] },
      },
      select: { id: true, slug: true, title: true, length: true, userId: true },
    });
    return json(201, { event_type: et });
  });
}

async function slots(
  req: ApiRequest,
  m: string,
  orgId: string,
  deps: OrgApiDeps,
  need: Need
): Promise<ApiResponse> {
  if (m !== "GET") return err(405, "method_not_allowed", "use GET");
  if (!need("bookings:read")) return err(403, "forbidden", "scope bookings:read required");
  const eventTypeId = Number(req.query.get("eventTypeId"));
  const start = req.query.get("start");
  const end = req.query.get("end");
  const tz = req.query.get("timezone") ?? "UTC";
  if (
    !Number.isInteger(eventTypeId) ||
    !start ||
    !end ||
    Number.isNaN(Date.parse(start)) ||
    Number.isNaN(Date.parse(end)) ||
    Date.parse(end) <= Date.parse(start)
  )
    return err(400, "invalid_request", "eventTypeId, start and end (ISO, end > start) are required");
  if (Date.parse(end) - Date.parse(start) > 62 * 86_400_000)
    return err(400, "invalid_request", "range is limited to 62 days");
  const et = await deps.client.$transaction((tx: Any) =>
    tx.eventType.findFirst({ where: { id: eventTypeId, twOrgId: orgId }, select: { id: true } })
  );
  if (!et) return err(404, "not_found", "event type not found");
  const result = await deps.getSlots({ eventTypeId, startTime: start, endTime: end, timeZone: tz });
  return json(200, result);
}

async function bookings(
  req: ApiRequest,
  m: string,
  orgId: string,
  deps: OrgApiDeps,
  need: Need
): Promise<ApiResponse> {
  if (m !== "GET") return err(405, "method_not_allowed", "use GET");
  if (!need("bookings:read")) return err(403, "forbidden", "scope bookings:read required");
  const status = req.query.get("status");
  if (status && !BOOKING_STATUSES.includes(status)) return err(400, "invalid_request", "unknown status");
  const limit = Math.min(Math.max(Number(req.query.get("limit") ?? 50) || 50, 1), 200);
  const rows = await deps.client.$transaction((tx: Any) =>
    tx.booking.findMany({
      where: { twOrgId: orgId, ...(status ? { status } : {}) },
      select: {
        uid: true,
        title: true,
        startTime: true,
        endTime: true,
        status: true,
        eventTypeId: true,
        userId: true,
      },
      orderBy: { startTime: "desc" },
      take: limit,
    })
  );
  return json(200, { bookings: rows });
}

async function webhooks(
  req: ApiRequest,
  m: string,
  orgId: string,
  subId: string | undefined,
  deps: OrgApiDeps,
  need: Need
): Promise<ApiResponse> {
  if (!need("webhooks:write")) return err(403, "forbidden", "scope webhooks:write required");
  // Webhook rows carry no twOrgId; they belong to the org through the org's member users.
  const memberIds = async (tx: Any): Promise<number[]> =>
    (await tx.organizationMember.findMany({ where: { orgId }, select: { userId: true } })).map(
      (r: { userId: number }) => r.userId
    );

  if (m === "GET" && !subId) {
    return withTwOrg(deps.client, orgId, async (tx: Any) => {
      const rows = await tx.webhook.findMany({
        where: { userId: { in: await memberIds(tx) } },
        select: { id: true, subscriberUrl: true, eventTriggers: true, active: true, createdAt: true },
        take: 200,
      });
      return json(200, { webhooks: rows });
    });
  }
  if (m === "POST" && !subId) {
    const b = obj(req.body);
    const url = b && str(b.subscriber_url, 2048);
    let ok = false;
    try {
      ok = !!url && new URL(url).protocol === "https:";
    } catch {
      ok = false;
    }
    if (!b || !url || !ok) return err(400, "invalid_request", "subscriber_url must be an https URL");
    const triggers = b.triggers;
    if (
      !Array.isArray(triggers) ||
      triggers.length === 0 ||
      !triggers.every((t) => (WEBHOOK_TRIGGERS as readonly string[]).includes(t))
    )
      return err(
        400,
        "invalid_request",
        `triggers must be a non-empty subset of ${WEBHOOK_TRIGGERS.join(", ")}`
      );
    const secret = b.secret === undefined ? null : str(b.secret, 256);
    if (b.secret !== undefined && !secret)
      return err(400, "invalid_request", "secret must be a non-empty string");
    return withTwOrg(deps.client, orgId, async (tx: Any) => {
      const owner = await tx.organizationMember.findFirst({
        where: { orgId, role: "owner" },
        select: { userId: true },
      });
      if (!owner) return err(404, "not_found", "organization has no owner");
      const dup = await tx.webhook.findFirst({
        where: { userId: owner.userId, subscriberUrl: url },
        select: { id: true },
      });
      if (dup) return err(409, "duplicate", "a webhook for this URL already exists");
      const w = await tx.webhook.create({
        data: {
          id: randomUUID(),
          userId: owner.userId,
          subscriberUrl: url,
          eventTriggers: triggers,
          secret,
          active: true,
        },
        select: { id: true, subscriberUrl: true, eventTriggers: true, active: true },
      });
      return json(201, { webhook: w });
    });
  }
  if (m === "DELETE" && subId) {
    return withTwOrg(deps.client, orgId, async (tx: Any) => {
      const w = await tx.webhook.findFirst({
        where: { id: subId, userId: { in: await memberIds(tx) } },
        select: { id: true },
      });
      if (!w) return err(404, "not_found", "webhook not found");
      await tx.webhook.delete({ where: { id: subId } });
      return json(200, { deleted: true });
    });
  }
  return err(405, "method_not_allowed", "use GET, POST or DELETE");
}
