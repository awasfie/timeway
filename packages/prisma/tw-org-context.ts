/**
 * TW-T9 slice 2 — org context for the forced-RLS Organization tables.
 *
 * The TW-T9 tables (slice 1) return zero rows unless the CURRENT TRANSACTION set
 * `app.tw_org_id` (or `app.tw_platform = 'on'` for trusted provisioning code).
 * `set_config(..., true)` is transaction-local, so every scoped query must run
 * inside the same interactive `$transaction` that set it — a bare
 * `prisma.x.findMany()` outside it sees nothing (fail-closed by design).
 *
 * Callers pass an org id they resolved from the SESSION or a verified ORG API
 * KEY, never from a request parameter (TW-T9 / CC-13). This module only
 * enforces shape; provenance is the caller's contract and is probed by CC-13
 * as each surface lands (TW-T10+).
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Minimal shape of a Prisma client we need; keeps this file free of generated types. */
export interface TxCapableClient<Tx> {
  $transaction<R>(fn: (tx: Tx) => Promise<R>, options?: { timeout?: number; maxWait?: number }): Promise<R>;
}
export interface RawCapableTx {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
}

export class TwOrgContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TwOrgContextError";
  }
}

export function assertTwOrgId(orgId: unknown): asserts orgId is string {
  if (typeof orgId !== "string" || !UUID_RE.test(orgId)) {
    throw new TwOrgContextError("TW-T9: org context requires a UUID organization id");
  }
}

/** Run `fn` with `app.tw_org_id` set for one transaction. RLS scopes every TW-T9 read/write to that org. */
export async function withTwOrg<Tx extends RawCapableTx, R>(
  client: TxCapableClient<Tx>,
  orgId: string,
  fn: (tx: Tx) => Promise<R>,
  options?: { timeout?: number; maxWait?: number }
): Promise<R> {
  assertTwOrgId(orgId);
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`select set_config('app.tw_org_id', ${orgId}, true)`;
    return fn(tx);
  }, options);
}

/**
 * Platform context (provisioning, TW-T10 `/internal/provision`, migrations tooling).
 * Never reachable from a user request path; call sites are reviewed by name.
 */
export async function withTwPlatform<Tx extends RawCapableTx, R>(
  client: TxCapableClient<Tx>,
  reason: string,
  fn: (tx: Tx) => Promise<R>,
  options?: { timeout?: number; maxWait?: number }
): Promise<R> {
  if (!reason || !reason.trim()) throw new TwOrgContextError("TW-T9: platform context needs a reason");
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`select set_config('app.tw_platform', 'on', true)`;
    return fn(tx);
  }, options);
}
