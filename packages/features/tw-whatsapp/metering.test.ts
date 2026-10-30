import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("@calcom/prisma", () => ({ default: {} }));
vi.mock("@calcom/prisma/tw-org-context", () => ({ withTwOrg: vi.fn() }));
vi.mock("@calcom/prisma/client", () => {
  class PrismaClientKnownRequestError extends Error {
    code: string;
    constructor(message: string, opts: { code: string }) {
      super(message);
      this.code = opts.code;
    }
  }
  return { Prisma: { PrismaClientKnownRequestError } };
});

import { Prisma } from "@calcom/prisma/client";

import {
  CM3_WHATSAPP_INCLUDED,
  WA_USAGE_METER,
  buildUsagePayload,
  gateWhatsappReminder,
  recordWhatsappReminder,
  sendWhatsappReminderUsage,
  toPassportUsageBody,
  usageIdempotencyKey,
  usageReferenceUid,
  usageRef,
  utcPeriod,
  whatsappAllowance,
  type GateDeps,
  type OrgPlan,
  type WaUsagePayload,
} from "./metering";

const ORG = "6f1c1b7e-2a51-4c0e-9d47-1a2b3c4d5e6f";
const PARENT_PLAN_ORG = "0b6d9a6e-7d1f-4a51-8e2c-9f8e7d6c5b4a";
const UID = "bk_8Xq2LmNp4RtV9wYz1aBcD";
const ON = { TW_WA_METERING_ENABLED: "true" } as NodeJS.ProcessEnv;

/** In-memory Task ledger keyed by referenceUid (the Task (referenceUid, type) unique index). */
function ledger() {
  const rows = new Map<string, WaUsagePayload>();
  const createTask = vi.fn(async (p: WaUsagePayload, ref: string) => {
    if (rows.has(ref)) throw new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "x" } as never);
    rows.set(ref, p);
  });
  const countSent = vi.fn(async (period: string, org: string) =>
    [...rows.keys()].filter((k) => k.startsWith(`tw-wa:${period}:${org}:`)).length
  );
  return { rows, createTask, countSent };
}

function plans(map: Record<string, OrgPlan>): GateDeps["loadOrgPlan"] {
  return async (id) => map[id] ?? null;
}

async function sendOne(
  l: ReturnType<typeof ledger>,
  loadOrgPlan: GateDeps["loadOrgPlan"],
  bookingUid: string,
  now: Date,
  windowMin = 1440,
  messageId: string | null = `wamid.${bookingUid}`
) {
  const gate = await gateWhatsappReminder({ twOrgId: ORG, now }, { env: ON, loadOrgPlan, countSent: l.countSent });
  if (!gate.send || !gate.metered) return { gate, payload: null };
  const payload = buildUsagePayload(gate, { bookingUid, windowMin, messageId, at: now });
  const rec = await recordWhatsappReminder(payload, { createTask: l.createTask });
  return { gate, payload, rec };
}

describe("CM.3 allowance", () => {
  it("matches the committed Bible CM.3 TIMEWAY Confirmations row (Teams 200/mo, Business 1,000/mo)", () => {
    // sections/CM-5.md is generated from the Bible; the salesos copy is the law. Pin the parsed numbers here.
    const row =
      "| Confirmations | email + ICS | email + ICS + reminders (2) | + WhatsApp confirmations/reminders (via Whatsaff; 200/mo included, then $0.02 each) | + WhatsApp 1,000/mo included |";
    const cells = row.split("|").slice(1, -1).map((c) => c.trim());
    const n = (s: string) => Number(/([\d,]+)\/mo/.exec(s)![1].replace(/,/g, ""));
    expect(CM3_WHATSAPP_INCLUDED).toEqual({ teams: n(cells[3]), business: n(cells[4]) });
    expect(/WhatsApp/.test(cells[1]) || /WhatsApp/.test(cells[2])).toBe(false);
  });

  it("Free/Pro/unknown carry no WhatsApp; case-insensitive plan codes", () => {
    expect(whatsappAllowance("free")).toBeNull();
    expect(whatsappAllowance("pro")).toBeNull();
    expect(whatsappAllowance(null)).toBeNull();
    expect(whatsappAllowance(" Teams ")).toBe(200);
    expect(whatsappAllowance("BUSINESS")).toBe(1000);
  });

  it("no rate lives in the module (prices are Passport/Stripe only, PART CM)", () => {
    const src = readFileSync(resolve(__dirname, "metering.ts"), "utf8").replace(/\/\*\*?[\s\S]*?\*\/|\/\/.*$/gm, "");
    expect(src).not.toMatch(/0\.02|\$\s*\d|unit_amount|cents/i);
  });
});

describe("gate", () => {
  it("metering off: sends exactly as 10a, no ledger lookups", async () => {
    const loadOrgPlan = vi.fn();
    const g = await gateWhatsappReminder({ twOrgId: ORG, now: new Date() }, { env: {}, loadOrgPlan });
    expect(g).toEqual({ send: true, metered: false });
    expect(loadOrgPlan).not.toHaveBeenCalled();
  });

  it("metering on: no org or a plan without WhatsApp stops the send", async () => {
    const l = ledger();
    const now = new Date("2026-11-10T09:00:00Z");
    expect(await gateWhatsappReminder({ twOrgId: null, now }, { env: ON })).toEqual({ send: false, reason: "metering_no_org" });
    const pro = plans({ [ORG]: { twOrgId: ORG, planCode: "pro", parentPlanCode: null } });
    expect(await gateWhatsappReminder({ twOrgId: ORG, now }, { env: ON, loadOrgPlan: pro, countSent: l.countSent })).toEqual({
      send: false,
      reason: "metering_plan_excludes_whatsapp",
    });
  });

  it("a sub-org with no plan of its own inherits its parent's allowance", async () => {
    const l = ledger();
    const sub = plans({ [ORG]: { twOrgId: ORG, planCode: null, parentPlanCode: "business" } });
    const g = await gateWhatsappReminder({ twOrgId: ORG, now: new Date("2026-11-10T09:00:00Z") }, { env: ON, loadOrgPlan: sub, countSent: l.countSent });
    expect(g).toMatchObject({ send: true, metered: true, included: 1000, sentSoFar: 0 });
    void PARENT_PLAN_ORG;
  });
});

describe("cap enforcement (Teams 200/mo then billed)", () => {
  it("reminders 1..200 are ledger-only, 201+ are billable lines; the send never stops on Teams", async () => {
    const l = ledger();
    const teams = plans({ [ORG]: { twOrgId: ORG, planCode: "teams", parentPlanCode: null } });
    const now = new Date("2026-11-15T12:00:00Z");
    const out: WaUsagePayload[] = [];
    for (let i = 1; i <= 202; i++) {
      const r = await sendOne(l, teams, `bk_${i}`, now);
      expect(r.gate.send).toBe(true);
      out.push(r.payload!);
    }
    expect(out[0]).toMatchObject({ ordinal: 1, billable: false, included: 200, period: "2026-11" });
    expect(out[199]).toMatchObject({ ordinal: 200, billable: false });
    expect(out[200]).toMatchObject({ ordinal: 201, billable: true });
    expect(out[201]).toMatchObject({ ordinal: 202, billable: true });
    expect(out.filter((p) => p.billable)).toHaveLength(2);
  });
});

describe("month boundary", () => {
  it("the count resets at 00:00 UTC on the 1st; the last second of the month stays in the old period", async () => {
    const l = ledger();
    const teams = plans({ [ORG]: { twOrgId: ORG, planCode: "teams", parentPlanCode: null } });
    for (let i = 1; i <= 200; i++) await sendOne(l, teams, `oct_${i}`, new Date("2026-10-20T10:00:00Z"));
    const last = await sendOne(l, teams, "oct_last", new Date("2026-10-31T23:59:59Z"));
    expect(last.payload).toMatchObject({ period: "2026-10", ordinal: 201, billable: true });
    const first = await sendOne(l, teams, "nov_first", new Date("2026-11-01T00:00:00Z"));
    expect(first.payload).toMatchObject({ period: "2026-11", ordinal: 1, billable: false });
    expect(utcPeriod(new Date("2026-12-31T23:59:59.999Z"))).toBe("2026-12");
    expect(utcPeriod(new Date("2027-01-01T00:00:00Z"))).toBe("2027-01");
  });
});

describe("idempotent replay", () => {
  it("re-recording the same booking+window is a duplicate and does not move the count", async () => {
    const l = ledger();
    const teams = plans({ [ORG]: { twOrgId: ORG, planCode: "teams", parentPlanCode: null } });
    const now = new Date("2026-11-03T08:00:00Z");
    const a = await sendOne(l, teams, UID, now);
    expect(a.rec).toBe("recorded");
    const again = await recordWhatsappReminder(a.payload!, { createTask: l.createTask });
    expect(again).toBe("duplicate");
    expect(await l.countSent("2026-11", ORG)).toBe(1);
    // a second window for the same booking is a separate reminder
    const b = await sendOne(l, teams, UID, now, 60);
    expect(b.rec).toBe("recorded");
    expect(await l.countSent("2026-11", ORG)).toBe(2);
  });

  it("the Passport Idempotency-Key is booking uid + message id, the ref is stable per booking+window", () => {
    expect(usageIdempotencyKey(UID, "wamid.HBgM", 1440)).toBe(`tw-wa:${UID}:wamid.HBgM`);
    expect(usageIdempotencyKey(UID, null, 1440)).toBe(`tw-wa:${UID}:w1440`);
    expect(usageRef(UID, 1440)).toBe(`wr:${UID}-1440`);
    expect(usageRef(UID, 1440)).toMatch(/^[a-z]{2}:[A-Za-z0-9_-]{1,64}$/);
    expect(usageRef("x".repeat(80), 60)).toMatch(/^wr:[A-Za-z0-9_-]{64}$/);
    expect(usageReferenceUid("2026-11", ORG, UID, 60)).toBe(`tw-wa:2026-11:${ORG}:${UID}:60`);
  });

  it("handler: replaying the same billable task posts the same body+key; 409 counts as done", async () => {
    const l = ledger();
    const teams = plans({ [ORG]: { twOrgId: ORG, planCode: "teams", parentPlanCode: null } });
    const now = new Date("2026-11-05T08:00:00Z");
    for (let i = 1; i <= 200; i++) await sendOne(l, teams, `bk_${i}`, now);
    const { payload } = await sendOne(l, teams, UID, now);
    expect(payload!.billable).toBe(true);

    const calls: { body: Record<string, unknown>; key: string }[] = [];
    let status = 201;
    const postUsage = vi.fn(async (body: Record<string, unknown>, key: string) => {
      calls.push({ body, key });
      return { status, body: {} };
    });
    const deps = { postUsage, resolvePassportOrgId: async () => "pp_org_1", env: {} as NodeJS.ProcessEnv };
    await sendWhatsappReminderUsage(JSON.stringify(payload), deps);
    status = 409;
    await sendWhatsappReminderUsage(JSON.stringify(payload), deps);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual(calls[1]);
    expect(calls[0].key).toBe(`tw-wa:${UID}:wamid.${UID}`);
    expect(calls[0].body).toEqual({
      organizationId: "pp_org_1",
      meter: WA_USAGE_METER,
      period: "2026-11",
      ref: `wr:${UID}-1440`,
      value: 1,
      timestamp: Math.floor(now.getTime() / 1000),
    });
  });

  it("handler: included reminders never call Passport; 5xx and an unlinked org throw so the outbox retries", async () => {
    const included = buildUsagePayload(
      { send: true, metered: true, twOrgId: ORG, period: "2026-11", included: 200, sentSoFar: 0 },
      { bookingUid: UID, windowMin: 1440, messageId: "m1", at: new Date("2026-11-01T00:00:00Z") }
    );
    const postUsage = vi.fn();
    await sendWhatsappReminderUsage(JSON.stringify(included), { postUsage, resolvePassportOrgId: async () => "o" });
    expect(postUsage).not.toHaveBeenCalled();

    const billable = { ...included, ordinal: 201, billable: true };
    await expect(
      sendWhatsappReminderUsage(JSON.stringify(billable), { postUsage: async () => ({ status: 503, body: "down" }), resolvePassportOrgId: async () => "o" })
    ).rejects.toThrow(/503/);
    await expect(
      sendWhatsappReminderUsage(JSON.stringify(billable), { postUsage, resolvePassportOrgId: async () => null })
    ).rejects.toThrow(/not linked/);
    expect(toPassportUsageBody(billable, "o")).not.toHaveProperty("seq");
  });
});
