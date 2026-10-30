import type { RawCapableTx, TxCapableClient } from "@calcom/prisma/tw-org-context";
import { withTwOrg, withTwPlatform } from "@calcom/prisma/tw-org-context";

import type { WhatsaffConfig } from "./sender";

// WC-TW-10b: which Whatsaff phone number sends an org's reminders. The shared platform number
// (WHATSAFF_SENDER_PHONE_NUMBER_ID) is the default; an org's own number (the add-on) is used only
// when mode = own, an id is set and Whatsaff verified it. Any other state falls back to shared, so a
// half-configured add-on never stops reminders. The add-on price lives in PART CM, not here.

export type OrgWaSender = {
  waSenderMode: "shared" | "own" | null;
  waSenderPhoneNumberId: string | null;
  waSenderVerifiedAt: Date | null;
};

export type ResolvedSender = { senderId: string; source: "tenant" | "shared" };

export function resolveSender(org: OrgWaSender | null | undefined, sharedSenderId: string): ResolvedSender {
  const own = org?.waSenderPhoneNumberId?.trim();
  if (org?.waSenderMode === "own" && own && org.waSenderVerifiedAt)
    return { senderId: own, source: "tenant" };
  return { senderId: sharedSenderId, source: "shared" };
}

/** Config for one send: the shared config with the sender swapped when the org's own number is active. */
export function configForOrg(cfg: WhatsaffConfig, org: OrgWaSender | null | undefined): WhatsaffConfig {
  const { senderId } = resolveSender(org, cfg.senderId);
  return senderId === cfg.senderId ? cfg : { ...cfg, senderId };
}

interface QueryTx extends RawCapableTx {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

/**
 * Loads the sender columns for an org. The org id comes from the booking row (server-side), never
 * from request input. Errors resolve to null (shared sender): a lookup failure must not drop a reminder.
 */
export async function loadOrgSender(
  client: TxCapableClient<QueryTx>,
  twOrgId: string | null | undefined
): Promise<OrgWaSender | null> {
  if (!twOrgId) return null;
  try {
    const rows = await withTwOrg(
      client,
      twOrgId,
      (tx) =>
        tx.$queryRaw<OrgWaSender[]>`
        SELECT "waSenderMode"::text AS "waSenderMode", "waSenderPhoneNumberId", "waSenderVerifiedAt"
        FROM "tw_organization" WHERE "id" = ${twOrgId}::uuid`
    );
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

type FetchLike = (
  url: string,
  init: RequestInit
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Lists the WhatsApp numbers Whatsaff holds for our account (GET /api/whatsapp/phone-numbers, same
 * x-api-key as send). A tenant number provisioned through Whatsaff numbers shows up here.
 */
export async function listWhatsaffNumbers(
  cfg: Pick<WhatsaffConfig, "apiUrl" | "apiKey">,
  fetchImpl: FetchLike = fetch as unknown as FetchLike
): Promise<{ id: string; display: string }[]> {
  const res = await fetchImpl(`${cfg.apiUrl}/api/whatsapp/phone-numbers`, {
    method: "GET",
    headers: { "x-api-key": cfg.apiKey },
  });
  if (!res.ok) throw new Error(`Whatsaff phone-numbers returned ${res.status}`);
  const json = (await res.json()) as { data?: { id?: unknown; display_phone_number?: unknown }[] };
  return (json.data ?? [])
    .filter((n) => typeof n.id === "string" && n.id)
    .map((n) => ({
      id: n.id as string,
      display: typeof n.display_phone_number === "string" ? n.display_phone_number : "",
    }));
}

export type SetSenderInput = { mode: "shared" } | { mode: "own"; phoneNumberId: string };

/**
 * Org setting write. `own` is stored verified only when Whatsaff lists the number for our account;
 * an unlisted id is rejected and nothing changes. `shared` keeps the stored id (re-enable is one switch)
 * but resolution ignores it. Platform context: called from the reviewed admin/provisioning path only.
 */
export async function setOrgSender(
  client: TxCapableClient<QueryTx>,
  twOrgId: string,
  input: SetSenderInput,
  cfg: Pick<WhatsaffConfig, "apiUrl" | "apiKey">,
  now: Date = new Date(),
  fetchImpl?: FetchLike
): Promise<{ ok: true; mode: "shared" | "own" } | { ok: false; reason: "number_not_found" }> {
  if (input.mode === "shared") {
    await withTwPlatform(
      client,
      "wc-tw-10b set wa sender",
      (tx) =>
        tx.$executeRaw`UPDATE "tw_organization" SET "waSenderMode" = 'shared'::"TwWaSenderMode" WHERE "id" = ${twOrgId}::uuid`
    );
    return { ok: true, mode: "shared" };
  }
  const numbers = await listWhatsaffNumbers(cfg, fetchImpl);
  const hit = numbers.find((n) => n.id === input.phoneNumberId.trim());
  if (!hit) return { ok: false, reason: "number_not_found" };
  await withTwPlatform(
    client,
    "wc-tw-10b set wa sender",
    (tx) =>
      tx.$executeRaw`
      UPDATE "tw_organization"
      SET "waSenderMode" = 'own'::"TwWaSenderMode", "waSenderPhoneNumberId" = ${hit.id},
          "waSenderDisplayNumber" = ${hit.display || null}, "waSenderVerifiedAt" = ${now}
      WHERE "id" = ${twOrgId}::uuid`
  );
  return { ok: true, mode: "own" };
}
