/**
 * TW-T9.2b1 — org scope for authenticated entry points (NextAuth, tRPC, apps/web API routes).
 *
 * The org id comes from exactly two places (CC-13): the signed NextAuth JWT
 * (`token.twOrgId`, written at login from the user's own row) or, in API v2, the user
 * row of a verified API key / access token. Never from a request param, header or body.
 *
 * A missing or malformed twOrgId opens no scope. Before RLS (TW-T9.2d) that is the old
 * behaviour; after it the request sees zero tenant rows. There is deliberately no
 * platform fallback here.
 */

import process from "node:process";
import { runWithTwOrg } from "@calcom/prisma/tw-org-context";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function twOrgIdOf(holder: { twOrgId?: unknown } | null | undefined): string | null {
  const value = holder?.twOrgId;
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

export function runWithSessionTwOrg<R>(
  twOrgId: string | null | undefined,
  fn: () => R | PromiseLike<R>
): Promise<R> {
  if (!twOrgId) return Promise.resolve().then(fn);
  return runWithTwOrg(twOrgId, fn);
}

type RawQueryClient = {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
};

export type LoginPrincipal = { id: number; twOrgId: string | null };

/**
 * Pre-tenant login lookup through the SECURITY DEFINER function from TW-T9.2a: it is
 * the only read that may run before the org is known, and it returns id + org only.
 */
export async function resolveLoginPrincipal(
  client: RawQueryClient,
  email: string | null | undefined
): Promise<LoginPrincipal | null> {
  if (!email) return null;
  const rows = await client.$queryRaw<{ id: number; twOrgId: string | null }[]>`
    select id, "twOrgId" from public.tw_resolve_user_for_login(${email})`;
  const row = rows?.[0];
  if (!row) return null;
  return { id: row.id, twOrgId: twOrgIdOf(row) };
}

type TokenRequest = Parameters<typeof import("next-auth/jwt").getToken>[0]["req"];
export type TwOrgIdReader<Req> = (req: Req) => Promise<string | null>;

/** Reads twOrgId from the signed session JWT only; a forged or absent cookie yields null. */
export async function readSessionTwOrgId(req: unknown): Promise<string | null> {
  if (!req) return null;
  const { getToken } = await import("next-auth/jwt");
  try {
    const token = await getToken({ req: req as TokenRequest, secret: process.env.NEXTAUTH_SECRET });
    return twOrgIdOf(token);
  } catch {
    return null;
  }
}

/** Wraps a route handler so everything it does runs in the session's org scope. */
export function withSessionTwOrg<Req, Rest extends unknown[], R>(
  handler: (req: Req, ...rest: Rest) => R | PromiseLike<R>,
  readTwOrgId: TwOrgIdReader<Req> = readSessionTwOrgId
): (req: Req, ...rest: Rest) => Promise<R> {
  return async (req: Req, ...rest: Rest) => {
    const twOrgId = await readTwOrgId(req);
    return runWithSessionTwOrg(twOrgId, () => handler(req, ...rest));
  };
}
