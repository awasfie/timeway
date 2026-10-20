import { Prisma } from "@calcom/prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@calcom/prisma", () => ({ default: {} }));
vi.mock("@calcom/prisma/tw-org-context", () => ({ withTwOrg: vi.fn() }));

import type { FeePayment, PlatformFeeUsagePayload, SendDeps } from "./platformFee";
import {
  PLATFORM_FEE_METER,
  PLATFORM_FEE_PRODUCT,
  PLATFORM_FEE_SEQ_CEILING,
  enqueuePlatformFeeUsage,
  platformFeeIdempotencyKey,
  platformFeeSeq,
  sendPlatformFeeUsage,
  toPassportUsageBody,
} from "./platformFee";

const TW_ORG = "6f1c2a1e-3b9d-4c8e-9a51-0d2b7e4f1a10";
const PASSPORT_ORG = "0b8d7c6e-5f4a-4b3c-8d2e-1f0a9b8c7d6e";
const NOW = new Date("2026-10-20T08:00:00.000Z");
// ProcessEnv is augmented with required keys (NODE_ENV); tests pass only the names under test.
const testEnv = (vars: Record<string, string | undefined>) => vars as unknown as NodeJS.ProcessEnv;
const ENV_ON = testEnv({ TW_PLATFORM_FEE_USAGE_ENABLED: "true" });

function payment(overrides: Partial<FeePayment> = {}): FeePayment {
  return {
    id: 41,
    uid: "pay_uid_41",
    amount: 12500,
    currency: "aed",
    success: true,
    refunded: false,
    booking: { twOrgId: TW_ORG },
    ...overrides,
  };
}

/** In-memory stand-in for the Task table and its (referenceUid, type) unique index. */
function taskStore() {
  const rows = new Map<string, PlatformFeeUsagePayload>();
  const createTask = vi.fn(async (p: PlatformFeeUsagePayload, referenceUid: string) => {
    if (rows.has(referenceUid)) {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      });
    }
    rows.set(referenceUid, p);
    return referenceUid;
  });
  return { rows, createTask };
}

describe("enqueuePlatformFeeUsage", () => {
  let store: ReturnType<typeof taskStore>;
  let current: FeePayment | null;
  const deps = () => ({
    findPayment: vi.fn(async () => current),
    createTask: store.createTask,
    now: () => NOW,
    env: ENV_ON,
  });

  beforeEach(() => {
    store = taskStore();
    current = payment();
  });

  it("enqueues one charge line per payment across duplicate webhooks and re-enqueues", async () => {
    const d = deps();
    const outcomes = [];
    for (let i = 0; i < 4; i++) outcomes.push(await enqueuePlatformFeeUsage({ paymentId: 41, kind: "charge" }, d));

    expect(outcomes).toEqual(["enqueued", "duplicate", "duplicate", "duplicate"]);
    expect(store.rows.size).toBe(1);
    const line = store.rows.get("tw-fee:pay_uid_41");
    expect(line).toEqual({
      kind: "charge",
      idempotencyKey: "tw-fee:pay_uid_41",
      product: PLATFORM_FEE_PRODUCT,
      meter: PLATFORM_FEE_METER,
      paymentId: 41,
      paymentUid: "pay_uid_41",
      value: 12500,
      currency: "AED",
      twOrgId: TW_ORG,
      period: "2026-10",
      seq: 82,
      timestamp: Math.floor(NOW.getTime() / 1000),
    });
  });

  it("refund adds exactly one negative correction keyed tw-fee-refund:<uid>", async () => {
    const d = deps();
    await enqueuePlatformFeeUsage({ paymentId: 41, kind: "charge" }, d);
    current = payment({ refunded: true });
    expect(await enqueuePlatformFeeUsage({ paymentId: 41, kind: "refund" }, d)).toBe("enqueued");
    expect(await enqueuePlatformFeeUsage({ paymentId: 41, kind: "refund" }, d)).toBe("duplicate");

    expect([...store.rows.keys()]).toEqual(["tw-fee:pay_uid_41", "tw-fee-refund:pay_uid_41"]);
    const refund = store.rows.get("tw-fee-refund:pay_uid_41");
    expect(refund?.value).toBe(-12500);
    expect(refund?.kind).toBe("refund");
    expect(refund?.seq).toBe(83);
    expect(refund?.seq).not.toBe(store.rows.get("tw-fee:pay_uid_41")?.seq);
  });

  it("refund before Payment.refunded is set enqueues nothing", async () => {
    expect(await enqueuePlatformFeeUsage({ paymentId: 41, kind: "refund" }, deps())).toBe("not_refunded");
    expect(store.createTask).not.toHaveBeenCalled();
  });

  it.each([undefined, "false", "1", "TRUE", ""])("flag %s enqueues nothing and reads nothing", async (flag) => {
    const d = { ...deps(), env: testEnv({ TW_PLATFORM_FEE_USAGE_ENABLED: flag }) };
    expect(await enqueuePlatformFeeUsage({ paymentId: 41, kind: "charge" }, d)).toBe("disabled");
    expect(d.findPayment).not.toHaveBeenCalled();
    expect(store.createTask).not.toHaveBeenCalled();
  });

  it.each([
    ["payment_not_found", null],
    ["not_paid", payment({ success: false })],
    ["zero_amount", payment({ amount: 0 })],
    ["no_org", payment({ booking: { twOrgId: null } })],
    ["no_org", payment({ booking: null })],
  ] as const)("returns %s and enqueues nothing", async (outcome, p) => {
    current = p;
    expect(await enqueuePlatformFeeUsage({ paymentId: 41, kind: "charge" }, deps())).toBe(outcome);
    expect(store.createTask).not.toHaveBeenCalled();
  });

  it("never throws into the booking path when the outbox write fails", async () => {
    const d = { ...deps(), createTask: vi.fn(async () => Promise.reject(new Error("db down"))) };
    await expect(enqueuePlatformFeeUsage({ paymentId: 41, kind: "charge" }, d)).resolves.toBe("error");
    const d2 = { ...deps(), findPayment: vi.fn(async () => Promise.reject(new Error("db down"))) };
    await expect(enqueuePlatformFeeUsage({ paymentId: 41, kind: "charge" }, d2)).resolves.toBe("error");
  });

  it("idempotency keys and seqs are fixed per payment and kind", () => {
    expect(platformFeeIdempotencyKey("charge", "u1")).toBe("tw-fee:u1");
    expect(platformFeeIdempotencyKey("refund", "u1")).toBe("tw-fee-refund:u1");
    expect(platformFeeSeq("charge", 7)).toBe(14);
    expect(platformFeeSeq("refund", 7)).toBe(15);
    expect(() => platformFeeSeq("charge", PLATFORM_FEE_SEQ_CEILING / 2)).toThrow(/seq range/);
  });
});

describe("sendPlatformFeeUsage", () => {
  const line: PlatformFeeUsagePayload = {
    kind: "charge",
    idempotencyKey: "tw-fee:pay_uid_41",
    product: PLATFORM_FEE_PRODUCT,
    meter: PLATFORM_FEE_METER,
    paymentId: 41,
    paymentUid: "pay_uid_41",
    value: 12500,
    currency: "AED",
    twOrgId: TW_ORG,
    period: "2026-10",
    seq: 82,
    timestamp: 1792483200,
  };
  const raw = JSON.stringify(line);

  function sendDeps(status: number, body: unknown = {}): SendDeps & { postUsage: ReturnType<typeof vi.fn> } {
    return {
      resolvePassportOrgId: vi.fn(async () => PASSPORT_ORG),
      postUsage: vi.fn(async () => ({ status, body })),
      env: testEnv({}),
    };
  }

  it("posts the ReportUsageDto body under the line's Idempotency-Key", async () => {
    const d = sendDeps(202);
    await sendPlatformFeeUsage(raw, d);
    expect(d.postUsage).toHaveBeenCalledTimes(1);
    expect(d.postUsage).toHaveBeenCalledWith(
      {
        organizationId: PASSPORT_ORG,
        meter: "timeway_paid_booking_volume",
        period: "2026-10",
        seq: 82,
        value: 12500,
        timestamp: 1792483200,
      },
      "tw-fee:pay_uid_41",
      testEnv({})
    );
    expect(Object.keys(toPassportUsageBody(line, PASSPORT_ORG)).sort()).toEqual(
      ["meter", "organizationId", "period", "seq", "timestamp", "value"].sort()
    );
  });

  it.each([200, 201, 202, 409])("Passport %s marks the line done (no retry)", async (status) => {
    await expect(sendPlatformFeeUsage(raw, sendDeps(status))).resolves.toBeUndefined();
  });

  it.each([500, 502, 503, 400, 401, 429])("Passport %s throws so the Tasker retries", async (status) => {
    await expect(sendPlatformFeeUsage(raw, sendDeps(status, { message: "boom" }))).rejects.toThrow(
      new RegExp(`answered ${status} for tw-fee:pay_uid_41`)
    );
  });

  it("network failure throws so the Tasker retries", async () => {
    const d = { ...sendDeps(202), postUsage: vi.fn(async () => Promise.reject(new TypeError("fetch failed"))) };
    await expect(sendPlatformFeeUsage(raw, d)).rejects.toThrow("fetch failed");
  });

  it("org not linked to Passport yet throws (retried) and posts nothing", async () => {
    const d = { ...sendDeps(202), resolvePassportOrgId: vi.fn(async () => null) };
    await expect(sendPlatformFeeUsage(raw, d)).rejects.toThrow(/not linked to a Passport organization/);
    expect(d.postUsage).not.toHaveBeenCalled();
  });

  it("rejects a malformed payload instead of sending it", async () => {
    const d = sendDeps(202);
    await expect(sendPlatformFeeUsage(JSON.stringify({ ...line, idempotencyKey: "x" }), d)).rejects.toThrow();
    expect(d.postUsage).not.toHaveBeenCalled();
  });

  describe("default Passport client", () => {
    const fetchMock = vi.fn();
    beforeEach(() => {
      fetchMock.mockReset();
      vi.stubGlobal("fetch", fetchMock);
    });

    const resolve = { resolvePassportOrgId: vi.fn(async () => PASSPORT_ORG) };

    it.each([
      [{ PASSPORT_URL: "https://passport.test" }],
      [{ PASSPORT_USAGE_TOKEN: "psk_test_secret_value" }],
      [{ PASSPORT_URL: "", PASSPORT_USAGE_TOKEN: "" }],
    ])("missing PASSPORT_URL/TOKEN throws without leaking values (%o)", async (env) => {
      const err = await sendPlatformFeeUsage(raw, { ...resolve, env: testEnv(env) }).catch((e) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err.message).toBe("PASSPORT_URL or PASSPORT_USAGE_TOKEN is not set");
      expect(err.message).not.toContain("psk_test_secret_value");
      expect(err.message).not.toContain("passport.test");
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("sends bearer token, Idempotency-Key and JSON to <PASSPORT_URL>/v1/usage", async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ identifier: "x" }), { status: 202 }));
      const env = { PASSPORT_URL: "https://passport.test/", PASSPORT_USAGE_TOKEN: "psk_test_secret_value" };
      await sendPlatformFeeUsage(raw, { ...resolve, env: testEnv(env) });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe("https://passport.test/v1/usage");
      expect(init.method).toBe("POST");
      expect(init.headers).toMatchObject({
        Authorization: "Bearer psk_test_secret_value",
        "Idempotency-Key": "tw-fee:pay_uid_41",
        "Content-Type": "application/json",
      });
      expect(JSON.parse(init.body)).toEqual(toPassportUsageBody(line, PASSPORT_ORG));
    });

    it("a 500 error message carries neither the token nor the URL", async () => {
      fetchMock.mockResolvedValue(new Response("internal", { status: 500 }));
      const env = { PASSPORT_URL: "https://passport.test", PASSPORT_USAGE_TOKEN: "psk_test_secret_value" };
      const err = await sendPlatformFeeUsage(raw, { ...resolve, env: testEnv(env) }).catch((e) => e);
      expect(err.message).toMatch(/answered 500/);
      expect(err.message).not.toContain("psk_test_secret_value");
      expect(err.message).not.toContain("passport.test");
    });
  });
});
