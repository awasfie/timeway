import { getTwOrgContext } from "@calcom/prisma/tw-org-context";
import { describe, expect, it, vi } from "vitest";

vi.mock("@calcom/lib/logger", () => ({
  default: { getSubLogger: () => ({ warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() }) },
}));

import {
  resolveTwOrgForBookingUid,
  resolveTwOrgForCredential,
  runInResolvedTwOrg,
  selectedCalendarTwOrgScope,
  TW_UNATTENDED_PLATFORM_REASONS,
  type TwUnattendedPlatformReason,
  withTwPlatformJob,
} from "./unattended";

const ORG = "6f1c2b1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b";
const OTHER_ORG = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

type Row = { id: number; twOrgId: string | null };

/** Fake client: records the SQL text and bound values of each $queryRaw call. */
function fakeClient(rows: Row[]) {
  const calls: { sql: string; values: unknown[] }[] = [];
  return {
    calls,
    $queryRaw<T>(strings: TemplateStringsArray, ...values: unknown[]): Promise<T> {
      calls.push({ sql: strings.join("?"), values });
      return Promise.resolve(rows as unknown as T);
    },
  };
}

describe("TW-T9.2b3 unattended org scope", () => {
  it("resolves a credential's org through tw_resolve_org_for_credential", async () => {
    const client = fakeClient([{ id: 7, twOrgId: ORG }]);
    expect(await resolveTwOrgForCredential(client, 7)).toBe(ORG);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].sql).toContain("public.tw_resolve_org_for_credential(");
    expect(client.calls[0].values).toEqual([7]);
  });

  it("resolves a booking's org through tw_resolve_org_for_booking_uid", async () => {
    const client = fakeClient([{ id: 3, twOrgId: ORG }]);
    expect(await resolveTwOrgForBookingUid(client, "bk-uid")).toBe(ORG);
    expect(client.calls[0].sql).toContain("public.tw_resolve_org_for_booking_uid(");
    expect(client.calls[0].values).toEqual(["bk-uid"]);
  });

  it("returns null for a NULL org, a missing row, a malformed org or no id (no query for no id)", async () => {
    expect(await resolveTwOrgForCredential(fakeClient([{ id: 7, twOrgId: null }]), 7)).toBeNull();
    expect(await resolveTwOrgForCredential(fakeClient([]), 7)).toBeNull();
    expect(await resolveTwOrgForCredential(fakeClient([{ id: 7, twOrgId: "nope" }]), 7)).toBeNull();
    const idle = fakeClient([{ id: 7, twOrgId: ORG }]);
    expect(await resolveTwOrgForCredential(idle, null)).toBeNull();
    expect(await resolveTwOrgForBookingUid(idle, "")).toBeNull();
    expect(idle.calls).toHaveLength(0);
  });

  it("calendar webhook: credential -> org, work runs in that org scope", async () => {
    const scope = selectedCalendarTwOrgScope(fakeClient([{ id: 7, twOrgId: ORG }]));
    const outcome = await scope.run({ id: "sc1", credentialId: 7 }, () => getTwOrgContext());
    expect(outcome).toEqual({ ran: true, value: { kind: "org", orgId: ORG } });
    expect(getTwOrgContext()).toBeUndefined();
  });

  it("calendar webhook: NULL org or no credential -> ack with no work and no platform fallback", async () => {
    const work = vi.fn();
    const nullOrg = selectedCalendarTwOrgScope(fakeClient([{ id: 7, twOrgId: null }]));
    expect(await nullOrg.run({ id: "sc1", credentialId: 7 }, work)).toEqual({
      ran: false,
      reason: "org-unresolved",
    });
    const noCred = selectedCalendarTwOrgScope(fakeClient([{ id: 7, twOrgId: ORG }]));
    expect(await noCred.run({ id: "sc2", credentialId: null }, work)).toEqual({
      ran: false,
      reason: "org-unresolved",
    });
    expect(work).not.toHaveBeenCalled();
  });

  it("ignores an orgId carried on the payload: only the credential row decides", async () => {
    const scope = selectedCalendarTwOrgScope(fakeClient([{ id: 7, twOrgId: ORG }]));
    const payloadLike = { id: "sc1", credentialId: 7, twOrgId: OTHER_ORG, orgId: OTHER_ORG };
    const outcome = await scope.run(payloadLike, () => getTwOrgContext());
    expect(outcome).toEqual({ ran: true, value: { kind: "org", orgId: ORG } });

    const nullScope = selectedCalendarTwOrgScope(fakeClient([{ id: 7, twOrgId: null }]));
    const work = vi.fn();
    expect((await nullScope.run(payloadLike, work)).ran).toBe(false);
    expect(work).not.toHaveBeenCalled();
  });

  it("runInResolvedTwOrg runs nothing without an org", async () => {
    const work = vi.fn();
    expect(await runInResolvedTwOrg(null, work)).toEqual({ ran: false, reason: "org-unresolved" });
    expect(work).not.toHaveBeenCalled();
  });

  it("withTwPlatformJob runs the handler in the named platform scope and passes args through", async () => {
    const handler = vi.fn(async (a: number, b: string) => ({ ctx: getTwOrgContext(), a, b }));
    const wrapped = withTwPlatformJob("bookingReminder", handler);
    expect(await wrapped(1, "x")).toEqual({
      ctx: { kind: "platform", reason: "bookingReminder" },
      a: 1,
      b: "x",
    });
    expect(getTwOrgContext()).toBeUndefined();
  });

  it("withTwPlatformJob refuses a reason that is not on the reviewed list", () => {
    expect(() => withTwPlatformJob("anything-goes" as TwUnattendedPlatformReason, () => 1)).toThrow(
      /unlisted platform reason/
    );
    expect(new Set(TW_UNATTENDED_PLATFORM_REASONS).size).toBe(TW_UNATTENDED_PLATFORM_REASONS.length);
  });
});
