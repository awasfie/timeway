/**
 * CC-13 tRPC harness (WC-TW-7b): a caller for a seeded user and the "denied, and A unchanged" assertion.
 * Handlers run in-process with a constructed ctx (no HTTP), as bookings/get.handler.integration-test.ts does.
 */
import { prisma } from "@calcom/prisma";
import { appRouter } from "@calcom/trpc/server/routers/_app";
import { createContextInner } from "@calcom/trpc/server/createContext";
import { createCallerFactory } from "@calcom/trpc/server/trpc";
import { expect } from "vitest";

export async function viewerFor(userId: number) {
  const ctx = await createContextInner({
    locale: "en",
    sourceIp: "127.0.0.1",
    session: { user: { id: userId }, upId: `usr-${userId}`, hasValidLicense: true, expires: "2099-01-01" },
  } as never);
  return createCallerFactory(appRouter)(ctx).viewer;
}

const DENY_CODES = new Set(["NOT_FOUND", "FORBIDDEN", "UNAUTHORIZED"]);

type Outcome = { kind: "threw"; code: string; message: string } | { kind: "returned"; value: unknown };

export async function attempt(fn: () => Promise<unknown>): Promise<Outcome> {
  try {
    return { kind: "returned", value: await fn() };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    return { kind: "threw", code: err.code ?? "UNKNOWN", message: err.message ?? "" };
  }
}

/** B is denied when the call throws NOT_FOUND/FORBIDDEN/UNAUTHORIZED, or returns something `isEmpty` accepts. */
export function expectDenied(o: Outcome, isEmpty?: (v: unknown) => boolean) {
  if (o.kind === "threw") {
    const denied = DENY_CODES.has(o.code) || /UNAUTHORIZED|FORBIDDEN|NOT_FOUND|not found/i.test(o.message);
    expect({ threw: o.code, message: o.message.slice(0, 120), denied }).toMatchObject({ denied: true });
    return;
  }
  expect(isEmpty, `call returned data for tenant B: ${JSON.stringify(o.value)?.slice(0, 200)}`).toBeDefined();
  expect(isEmpty?.(o.value), `call returned data for tenant B: ${JSON.stringify(o.value)?.slice(0, 200)}`).toBe(
    true
  );
}

/** A's row, read directly, before and after the attempt: the write must not have landed. */
export async function expectUnchanged<T>(read: () => Promise<T>, run: () => Promise<void>) {
  const before = JSON.parse(JSON.stringify(await read()));
  expect(before, "fixture row missing before the attempt").not.toBeNull();
  await run();
  const after = JSON.parse(JSON.stringify(await read()));
  expect(after).toEqual(before);
}

export { prisma };
