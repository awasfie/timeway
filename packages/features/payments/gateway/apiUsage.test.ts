import { Prisma } from "@calcom/prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@calcom/prisma", () => ({ default: {} }));
vi.mock("@calcom/prisma/tw-org-context", () => ({ withTwPlatform: vi.fn(), withTwOrg: vi.fn() }));

import type { ApiBookingFacts, ApiUsagePayload, OrgRow } from "./apiUsage";
import {
  enqueueApiBookingUsage,
  enqueueManagedUserSnapshot,
  sendApiUsage,
  toPassportApiUsageBody,
} from "./apiUsage";

const id = (n: number) => `6f1c2a1e-3b9d-4c8e-9a51-0d2b7e4f1a${String(n).padStart(2, "0")}`;
const NOW = new Date("2026-10-20T08:00:00.000Z");
const testEnv = (vars: Record<string, string | undefined>) => vars as unknown as NodeJS.ProcessEnv;
const ON = testEnv({ TW_API_USAGE_ENABLED: "true" });

function taskStore() {
  const rows = new Map<string, ApiUsagePayload>();
  const createTask = vi.fn(async (p: ApiUsagePayload, ref: string) => {
    if (rows.has(ref)) {
      throw new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      });
    }
    rows.set(ref, p);
    return ref;
  });
  return { rows, createTask };
}

const org = (n: number, o: Partial<OrgRow> = {}): OrgRow => ({
  id: id(n),
  parentOrgId: null,
  billingAttribution: "self",
  isSandbox: false,
  managedMembers: 0,
  ...o,
});

describe("enqueueManagedUserSnapshot", () => {
  const run = (orgs: OrgRow[], store = taskStore(), env = ON, now = NOW) =>
    enqueueManagedUserSnapshot({
      loadOrgs: async () => orgs,
      createTask: store.createTask,
      now: () => now,
      env,
    }).then((r) => ({ r, store }));

  it("emits one line per billing org with the managed count, no clientOrgId", async () => {
    const { r, store } = await run([org(1, { managedMembers: 3 }), org(2)]);
    expect(r).toMatchObject({ enqueued: 1, billingOrgs: 1, errors: 0 });
    const [line] = [...store.rows.values()];
    expect(line).toMatchObject({
      meter: "timeway_api_managed_user",
      ref: `mu:${id(1)}`,
      period: "2026-10-20",
      value: 3,
      billingOrgId: id(1),
    });
    expect(line.clientOrgId).toBeUndefined();
    expect(line.idempotencyKey).toBe(`tw-api:timeway_api_managed_user:2026-10-20:mu:${id(1)}`);
  });

  it("sums client orgs that bill to the parent into the parent's single line (E5)", async () => {
    const orgs = [
      org(1, { managedMembers: 2 }),
      org(2, { parentOrgId: id(1), billingAttribution: "parent", managedMembers: 4 }),
      org(3, { parentOrgId: id(1), billingAttribution: "parent", managedMembers: 5 }),
      org(4, { parentOrgId: id(1), billingAttribution: "self", managedMembers: 7 }),
    ];
    const { store } = await run(orgs);
    const lines = [...store.rows.values()];
    expect(lines.find((l) => l.billingOrgId === id(1))?.value).toBe(11);
    expect(lines.find((l) => l.billingOrgId === id(4))?.value).toBe(7);
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.clientOrgId === undefined)).toBe(true);
  });

  it("sandbox and sandbox-child emit nothing and are excluded from the sum (E7)", async () => {
    const orgs = [
      org(1, { isSandbox: true, managedMembers: 9 }),
      org(2, { parentOrgId: id(1), billingAttribution: "parent", managedMembers: 4 }),
      org(3, { managedMembers: 1 }),
      org(4, { parentOrgId: id(3), billingAttribution: "parent", isSandbox: true, managedMembers: 6 }),
    ];
    const { store } = await run(orgs);
    expect([...store.rows.values()].map((l) => [l.billingOrgId, l.value])).toEqual([[id(3), 1]]);
  });

  it("running twice the same UTC day enqueues nothing new", async () => {
    const store = taskStore();
    const orgs = [org(1, { managedMembers: 3 })];
    const first = (await run(orgs, store)).r;
    const second = (await run(orgs, store, ON, new Date("2026-10-20T20:00:00.000Z"))).r;
    expect(first.enqueued).toBe(1);
    expect(second).toMatchObject({ enqueued: 0, duplicate: 1 });
    expect(store.rows.size).toBe(1);
  });

  it("a new day is a new identifier", async () => {
    const store = taskStore();
    const orgs = [org(1, { managedMembers: 3 })];
    await run(orgs, store);
    await run(orgs, store, ON, new Date("2026-10-21T00:30:00.000Z"));
    expect(store.rows.size).toBe(2);
  });

  it("flag off emits nothing and does not read orgs", async () => {
    const store = taskStore();
    const loadOrgs = vi.fn(async () => [org(1, { managedMembers: 3 })]);
    const r = await enqueueManagedUserSnapshot({
      loadOrgs,
      createTask: store.createTask,
      now: () => NOW,
      env: testEnv({}),
    });
    expect(r.enabled).toBe(false);
    expect(loadOrgs).not.toHaveBeenCalled();
    expect(store.rows.size).toBe(0);
  });
});

function facts(o: Partial<ApiBookingFacts> = {}): ApiBookingFacts {
  return {
    uid: "bkAb3_x-9",
    twOrgId: id(2),
    creationSource: "API_V2",
    viaPlatformOAuth: false,
    organizerManaged: true,
    org: { id: id(2), parentOrgId: id(1), billingAttribution: "parent", isSandbox: false },
    parent: { id: id(1), isSandbox: false },
    ...o,
  };
}

describe("enqueueApiBookingUsage", () => {
  const run = (
    f: ApiBookingFacts | null,
    store = taskStore(),
    env = ON,
    extra: { viaPlatformOAuth?: boolean } = {}
  ) =>
    enqueueApiBookingUsage(
      { bookingUid: f?.uid ?? "bkAb3_x-9", ...extra },
      { loadFacts: async () => f, createTask: store.createTask, now: () => NOW, env }
    ).then((outcome) => ({ outcome, store }));

  it("parent attribution: orgId = billing org, clientOrgId = originating org", async () => {
    const { outcome, store } = await run(facts());
    expect(outcome).toBe("enqueued");
    expect([...store.rows.values()][0]).toMatchObject({
      meter: "timeway_api_booking",
      ref: "bk:bkAb3_x-9",
      period: "2026-10",
      value: 1,
      billingOrgId: id(1),
      clientOrgId: id(2),
    });
  });

  it("self attribution bills the org itself", async () => {
    const { store } = await run(
      facts({ org: { id: id(2), parentOrgId: id(1), billingAttribution: "self", isSandbox: false } })
    );
    expect([...store.rows.values()][0]).toMatchObject({ billingOrgId: id(2), clientOrgId: id(2) });
  });

  it("duplicate create path = one line", async () => {
    const store = taskStore();
    expect((await run(facts(), store)).outcome).toBe("enqueued");
    expect((await run(facts(), store)).outcome).toBe("duplicate");
    expect(store.rows.size).toBe(1);
  });

  it("platform OAuth counts even when creationSource is not API_V2", async () => {
    const { outcome } = await run(facts({ creationSource: "WEBAPP" }), taskStore(), ON, {
      viaPlatformOAuth: true,
    });
    expect(outcome).toBe("enqueued");
  });

  it.each([
    ["webapp booking", facts({ creationSource: "WEBAPP" }), "not_api"],
    ["organizer not managed", facts({ organizerManaged: false }), "not_managed"],
    ["no org", facts({ twOrgId: null, org: null, parent: null }), "no_org"],
    [
      "sandbox org",
      facts({
        org: { id: id(2), parentOrgId: null, billingAttribution: "self", isSandbox: true },
        parent: null,
      }),
      "unbilled",
    ],
    ["sandbox parent", facts({ parent: { id: id(1), isSandbox: true } }), "unbilled"],
  ])("%s emits nothing", async (_n, f, expected) => {
    const { outcome, store } = await run(f);
    expect(outcome).toBe(expected);
    expect(store.rows.size).toBe(0);
  });

  it("flag off emits nothing and does not read the booking", async () => {
    const store = taskStore();
    const loadFacts = vi.fn(async () => facts());
    const outcome = await enqueueApiBookingUsage(
      { bookingUid: "bkAb3_x-9" },
      { loadFacts, createTask: store.createTask, env: testEnv({}) }
    );
    expect(outcome).toBe("disabled");
    expect(loadFacts).not.toHaveBeenCalled();
    expect(store.rows.size).toBe(0);
  });

  it("an enqueue failure is swallowed so booking is never blocked", async () => {
    const outcome = await enqueueApiBookingUsage(
      { bookingUid: "bkAb3_x-9" },
      {
        loadFacts: async () => facts(),
        createTask: async () => {
          throw new Error("db down");
        },
        now: () => NOW,
        env: ON,
      }
    );
    expect(outcome).toBe("error");
  });
});

describe("sendApiUsage", () => {
  const PASSPORT: Record<string, string> = { [id(1)]: "p-parent", [id(2)]: "p-client" };
  const line = (o: Partial<ApiUsagePayload> = {}): ApiUsagePayload => ({
    idempotencyKey: "tw-api:timeway_api_booking:bk:x",
    product: "TIMEWAY",
    meter: "timeway_api_booking",
    ref: "bk:x",
    period: "2026-10",
    value: 1,
    billingOrgId: id(1),
    clientOrgId: id(2),
    timestamp: 1792000000,
    ...o,
  });
  const send = (p: ApiUsagePayload, status: number) => {
    const postUsage = vi.fn(async () => ({ status, body: null }));
    return {
      postUsage,
      promise: sendApiUsage(JSON.stringify(p), {
        resolvePassportOrgId: async (t) => PASSPORT[t] ?? null,
        postUsage,
        env: ON,
      }),
    };
  };

  it("booking body carries ref and the client org; Idempotency-Key is the identifier", async () => {
    const s = send(line(), 200);
    await s.promise;
    expect(s.postUsage).toHaveBeenCalledWith(
      {
        organizationId: "p-parent",
        meter: "timeway_api_booking",
        period: "2026-10",
        ref: "bk:x",
        value: 1,
        timestamp: 1792000000,
        clientOrgId: "p-client",
      },
      "tw-api:timeway_api_booking:bk:x",
      ON
    );
  });

  it("managed-user body never carries clientOrgId", () => {
    const body = toPassportApiUsageBody(
      line({ meter: "timeway_api_managed_user", ref: `mu:${id(1)}`, clientOrgId: id(2) }),
      "p-parent",
      "p-client"
    );
    expect(body).not.toHaveProperty("clientOrgId");
  });

  it("409 counts as sent; 5xx and an unlinked org retry", async () => {
    await expect(send(line(), 409).promise).resolves.toBeUndefined();
    await expect(send(line(), 503).promise).rejects.toThrow(/503/);
    await expect(send(line({ billingOrgId: id(9) }), 200).promise).rejects.toThrow(/not linked/);
  });
});
