/**
 * WC-TW-14b — sub-org provisioning on the TW-T10 org API (decisions E1, E3, E4, E5, E7).
 *
 *   POST  /orgs/{orgId}/sub-orgs            orgs:write  {client_ref, name, slug?, billing_attribution?, hide_branding?}
 *   GET   /orgs/{orgId}/sub-orgs            orgs:read
 *   GET   /orgs/{orgId}/sub-orgs/{subId}    orgs:read
 *   PATCH /orgs/{orgId}/sub-orgs/{subId}    orgs:write  {hide_branding?, billing_attribution?}
 *
 * The caller is always the parent org's key (checked by the router). Reads and writes of the
 * sub-orgs run in withTwPlatform after the code itself checks parentOrgId == caller org, so no RLS
 * policy is widened (E2). A sub-org belonging to another parent is 404, never 403. The API exposes
 * only clientRef; the stored externalRef is "sub:<parentOrgId>:<clientRef>" (E3).
 */
import { randomUUID } from "node:crypto";
import type { RawCapableTx, TxCapableClient } from "@calcom/prisma/tw-org-context";
import { assertTwOrgId, withTwPlatform } from "@calcom/prisma/tw-org-context";
import { assertCanHaveSubOrg, canHideBranding, TwSubOrgError } from "@calcom/prisma/tw-sub-org";
import { ProvisionError, slugify } from "./provision";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
export interface SubOrgTx extends RawCapableTx {
  organization: Any;
}
export type SubOrgClient = TxCapableClient<SubOrgTx>;

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;
const CLIENT_REF_MAX = 100;
const MAX_SUB_ORGS = 500;
const ATTRIBUTIONS = ["self", "parent"] as const;
type Attribution = (typeof ATTRIBUTIONS)[number];

export interface SubOrgInput {
  clientRef: string;
  name: string;
  slug?: string;
  billingAttribution: Attribution;
  hideBranding: boolean;
}
export interface SubOrgPatch {
  hideBranding?: boolean;
  billingAttribution?: Attribution;
}

const SELECT = {
  id: true,
  slug: true,
  name: true,
  externalRef: true,
  status: true,
  planCode: true,
  parentOrgId: true,
  hideBranding: true,
  billingAttribution: true,
  isSandbox: true,
  createdAt: true,
} as const;

const bad = (m: string) => new ProvisionError(400, "invalid_request", m);
const str = (v: unknown, max: number) =>
  typeof v === "string" && v.trim() && v.length <= max ? v.trim() : null;
const isUniqueViolation = (e: unknown) =>
  !!e && typeof e === "object" && (e as { code?: string }).code === "P2002";

export const subOrgExternalRef = (parentOrgId: string, clientRef: string) =>
  `sub:${parentOrgId}:${clientRef}`;

function attribution(v: unknown): Attribution {
  if (typeof v !== "string" || !(ATTRIBUTIONS as readonly string[]).includes(v))
    throw bad("billing_attribution must be self or parent");
  return v as Attribution;
}

export function parseSubOrgBody(body: unknown): SubOrgInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw bad("body must be a JSON object");
  const b = body as Record<string, unknown>;
  const clientRef = str(b.client_ref, CLIENT_REF_MAX);
  if (!clientRef) throw bad(`client_ref is required (string, <=${CLIENT_REF_MAX})`);
  const name = str(b.name, 120);
  if (!name) throw bad("name is required (string, <=120)");
  let slug: string | undefined;
  if (b.slug !== undefined) {
    const s = str(b.slug, 50);
    if (!s || !SLUG_RE.test(s)) throw bad("slug must be lowercase letters, digits and dashes");
    slug = s;
  }
  if (b.hide_branding !== undefined && typeof b.hide_branding !== "boolean")
    throw bad("hide_branding must be a boolean");
  return {
    clientRef,
    name,
    slug,
    billingAttribution: b.billing_attribution === undefined ? "self" : attribution(b.billing_attribution),
    hideBranding: b.hide_branding === true,
  };
}

export function parseSubOrgPatch(body: unknown): SubOrgPatch {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw bad("body must be a JSON object");
  const b = body as Record<string, unknown>;
  const out: SubOrgPatch = {};
  if (b.hide_branding !== undefined) {
    if (typeof b.hide_branding !== "boolean") throw bad("hide_branding must be a boolean");
    out.hideBranding = b.hide_branding;
  }
  if (b.billing_attribution !== undefined) out.billingAttribution = attribution(b.billing_attribution);
  if (Object.keys(out).length === 0) throw bad("nothing to change");
  return out;
}

type Row = {
  id: string;
  slug: string;
  name: string;
  externalRef: string | null;
  status: string;
  planCode: string | null;
  parentOrgId: string | null;
  hideBranding: boolean;
  billingAttribution: Attribution;
  isSandbox: boolean;
  createdAt: Date;
};

export function subOrgView(row: Row) {
  const prefix = `sub:${row.parentOrgId}:`;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    client_ref: row.externalRef?.startsWith(prefix) ? row.externalRef.slice(prefix.length) : null,
    parent_org_id: row.parentOrgId,
    status: row.status,
    hide_branding: row.hideBranding,
    billing_attribution: row.billingAttribution,
    is_sandbox: row.isSandbox,
    created_at: row.createdAt,
  };
}

const sameBody = (row: Row, input: SubOrgInput) =>
  row.name === input.name &&
  row.billingAttribution === input.billingAttribution &&
  row.hideBranding === input.hideBranding &&
  (input.slug === undefined || row.slug === input.slug);

async function loadParent(tx: SubOrgTx, parentOrgId: string) {
  const parent = await tx.organization.findUnique({
    where: { id: parentOrgId },
    select: { id: true, parentOrgId: true, planCode: true, isSandbox: true },
  });
  if (!parent) throw new ProvisionError(404, "not_found", "organization not found");
  return parent as {
    id: string;
    parentOrgId: string | null;
    planCode: string | null;
    isSandbox: boolean;
  };
}

/** E4: hideBranding may only be switched on when the sub-org's own or its parent's plan is entitled. */
function gateBranding(
  want: boolean,
  org: { id: string; parentOrgId: string | null; planCode: string | null },
  parent: { id: string; planCode: string | null }
) {
  if (want && !canHideBranding(org, parent))
    throw new ProvisionError(403, "not_entitled", "hiding Timeway branding is not part of this plan");
}

async function pickSlug(tx: SubOrgTx, wanted: string, explicit: boolean): Promise<string> {
  if (explicit) {
    if (
      await tx.organization.findUnique({
        where: { slug: wanted },
        select: { id: true },
      })
    )
      throw new ProvisionError(409, "slug_taken", "slug is already in use");
    return wanted;
  }
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? wanted : `${wanted.slice(0, 41)}-${randomUUID().slice(0, 6)}`;
    if (
      !(await tx.organization.findUnique({
        where: { slug: candidate },
        select: { id: true },
      }))
    )
      return candidate;
  }
  throw new ProvisionError(409, "slug_taken", "could not allocate a slug");
}

function oneLevel(parent: { id: string; parentOrgId: string | null }) {
  try {
    assertCanHaveSubOrg(parent);
  } catch (e) {
    if (e instanceof TwSubOrgError) throw new ProvisionError(409, "sub_org_depth", e.message);
    throw e;
  }
}

/** Idempotent on (parent, clientRef). Returns the sub-org and whether this call created it. */
export async function createSubOrg(
  client: SubOrgClient,
  parentOrgId: string,
  input: SubOrgInput
): Promise<{ created: boolean; org: ReturnType<typeof subOrgView> }> {
  assertTwOrgId(parentOrgId);
  const externalRef = subOrgExternalRef(parentOrgId, input.clientRef);
  const attempt = () =>
    withTwPlatform(client, `WC-TW-14b sub-org create ${externalRef}`, async (tx) => {
      const existing: Row | null = await tx.organization.findUnique({
        where: { externalRef },
        select: SELECT,
      });
      if (existing) {
        // The ref embeds the parent id, so a hit is always this parent's row.
        if (!sameBody(existing, input))
          throw new ProvisionError(
            409,
            "client_ref_conflict",
            "client_ref already used with a different body"
          );
        return { created: false, org: subOrgView(existing) };
      }
      const parent = await loadParent(tx, parentOrgId);
      oneLevel(parent);
      gateBranding(input.hideBranding, { id: "new", parentOrgId, planCode: null }, parent);
      const slug = await pickSlug(tx, input.slug ?? slugify(input.name), input.slug !== undefined);
      const row: Row = await tx.organization.create({
        data: {
          slug,
          name: input.name,
          externalRef,
          parentOrgId,
          hideBranding: input.hideBranding,
          billingAttribution: input.billingAttribution,
          isSandbox: parent.isSandbox, // E7: inherited, never chosen by the caller
          identityMode: "local",
        },
        select: SELECT,
      });
      return { created: true, org: subOrgView(row) };
    });
  try {
    return await attempt();
  } catch (e) {
    // Concurrent create: the loser re-reads the winner's row (slug clashes re-read and 409 as slug_taken).
    if (isUniqueViolation(e)) return attempt();
    throw e;
  }
}

export async function listSubOrgs(client: SubOrgClient, parentOrgId: string) {
  assertTwOrgId(parentOrgId);
  return withTwPlatform(client, "WC-TW-14b sub-org list", async (tx) => {
    const rows: Row[] = await tx.organization.findMany({
      where: { parentOrgId },
      select: SELECT,
      orderBy: { createdAt: "asc" },
      take: MAX_SUB_ORGS,
    });
    return rows.map(subOrgView);
  });
}

async function findOwned(tx: SubOrgTx, parentOrgId: string, subId: string): Promise<Row | null> {
  // parentOrgId in the where clause is the scoping check: another parent's sub-org is simply not found.
  return tx.organization.findFirst({
    where: { id: subId, parentOrgId },
    select: SELECT,
  });
}

export async function getSubOrg(client: SubOrgClient, parentOrgId: string, subId: string) {
  assertTwOrgId(parentOrgId);
  try {
    assertTwOrgId(subId);
  } catch {
    return null;
  }
  return withTwPlatform(client, "WC-TW-14b sub-org get", async (tx) => {
    const row = await findOwned(tx, parentOrgId, subId);
    return row ? subOrgView(row) : null;
  });
}

export async function patchSubOrg(
  client: SubOrgClient,
  parentOrgId: string,
  subId: string,
  patch: SubOrgPatch
) {
  assertTwOrgId(parentOrgId);
  try {
    assertTwOrgId(subId);
  } catch {
    return null;
  }
  return withTwPlatform(client, "WC-TW-14b sub-org patch", async (tx) => {
    const row = await findOwned(tx, parentOrgId, subId);
    if (!row) return null;
    if (patch.hideBranding === true && !row.hideBranding) {
      const parent = await loadParent(tx, parentOrgId);
      gateBranding(true, row, parent);
    }
    const data: Record<string, unknown> = {};
    if (patch.hideBranding !== undefined) data.hideBranding = patch.hideBranding;
    if (patch.billingAttribution !== undefined) data.billingAttribution = patch.billingAttribution;
    const updated: Row = await tx.organization.update({
      where: { id: subId },
      data,
      select: SELECT,
    });
    return subOrgView(updated);
  });
}
