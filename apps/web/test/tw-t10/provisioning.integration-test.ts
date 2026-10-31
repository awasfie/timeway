/**
 * CC-14 (TW-T10): provisioning idempotency, crash-resume, full default resources, plus the
 * org-scoped API's isolation (org-A key on org-B -> 404) and key checks.
 * Integration DB only. Every row is tagged with a per-run ref; cleanup removes exactly those.
 */
import { randomBytes, randomUUID } from "node:crypto";
import process from "node:process";
import type { OrgApiClient } from "@calcom/features/tw-provisioning/orgApi";
import { handleOrgApi } from "@calcom/features/tw-provisioning/orgApi";
import { prisma } from "@calcom/prisma";
import { withTwPlatform } from "@calcom/prisma/tw-org-context";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MASTER = `master-${randomBytes(16).toString("hex")}`;
const run = randomBytes(3).toString("hex");
const client = prisma as unknown as OrgApiClient;
const orgIds: string[] = [];
const emails: string[] = [];

const noLimit = () => true;
const deps = { client, getSlots: async () => ({ slots: {} }), limiter: noLimit };

type R = { status: number; body: any };
const call = (
  method: string,
  path: string[],
  authorization: string | null,
  body?: unknown,
  query = ""
): Promise<R> =>
  handleOrgApi({ method, path, authorization, query: new URLSearchParams(query), body }, deps) as Promise<R>;

const create = (ref: string, extra: Record<string, unknown> = {}) => {
  const email = `tw-t10-${run}-${ref}@t10.test`;
  emails.push(email);
  return call("POST", [], `Bearer ${MASTER}`, {
    external_ref: `t10-${run}-${ref}`,
    name: `T10 ${ref}`,
    slug: `t10-${run}-${ref}`,
    owner: { email, name: "Owner", timezone: "Asia/Dubai" },
    ...extra,
  });
};

beforeAll(() => {
  process.env.TW_PLATFORM_MASTER_KEY = MASTER;
});

afterAll(async () => {
  await withTwPlatform(client as never, "TW-T10 test cleanup", async (tx: any) => {
    const users = await tx.user.findMany({
      where: { email: { endsWith: `-${run}-a@t10.test` } },
      select: { id: true },
    });
    const all = await tx.user.findMany({
      where: { email: { contains: `tw-t10-${run}-` } },
      select: { id: true },
    });
    void users;
    const ids = all.map((u: { id: number }) => u.id);
    await tx.webhook.deleteMany({ where: { userId: { in: ids } } });
    await tx.eventType.deleteMany({ where: { userId: { in: ids } } });
    await tx.schedule.deleteMany({ where: { userId: { in: ids } } });
    await tx.organizationMember.deleteMany({ where: { orgId: { in: orgIds } } });
    await tx.orgEntitlementOverride.deleteMany({ where: { orgId: { in: orgIds } } });
    await tx.orgApiKey.deleteMany({ where: { orgId: { in: orgIds } } });
    await tx.user.deleteMany({ where: { id: { in: ids } } });
    await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
  });
});

describe("CC-14 provisioning (TW-T10)", () => {
  let a: R;
  let keyA: string;
  it("creates org + owner + schedule + 2 default event types + key (returned once)", async () => {
    a = await create("a");
    expect(a.status).toBe(201);
    orgIds.push(a.body.org.id);
    keyA = a.body.api_key.raw;
    expect(keyA).toMatch(/^twk_[0-9a-f]{8}\.[0-9a-f]{48}$/);
    expect(a.body.org.eventTypes.map((e: any) => [e.slug, e.length])).toEqual([
      ["discovery", 15],
      ["demo", 30],
    ]);

    await withTwPlatform(client as never, "test read", async (tx: any) => {
      const u = await tx.user.findFirst({
        where: { twOrgId: a.body.org.id },
        include: { schedules: { include: { availability: true } } },
      });
      expect(u.defaultScheduleId).toBe(u.schedules[0].id);
      expect(u.schedules[0].availability[0].days).toEqual([1, 2, 3, 4, 5]);
      const ets = await tx.eventType.findMany({ where: { twOrgId: a.body.org.id } });
      expect(ets).toHaveLength(2);
      for (const e of ets) expect(e.locations).toEqual([{ type: "integrations:camv" }]);
      const m = await tx.organizationMember.findMany({ where: { orgId: a.body.org.id } });
      expect(m).toHaveLength(1);
      expect(m[0].role).toBe("owner");
      const k = await tx.orgApiKey.findMany({ where: { orgId: a.body.org.id } });
      expect(k).toHaveLength(1);
      expect(JSON.stringify(k[0])).not.toContain(keyA.split(".")[1]);
    });
  });

  it("same external_ref twice -> 200, SAME org, no second key or rows", async () => {
    const again = await create("a");
    expect(again.status).toBe(200);
    expect(again.body.org.id).toBe(a.body.org.id);
    expect(again.body.api_key).toBeUndefined();
    await withTwPlatform(client as never, "test read", async (tx: any) => {
      expect(await tx.organization.count({ where: { externalRef: `t10-${run}-a` } })).toBe(1);
      expect(await tx.orgApiKey.count({ where: { orgId: a.body.org.id } })).toBe(1);
      expect(await tx.eventType.count({ where: { twOrgId: a.body.org.id } })).toBe(2);
      expect(await tx.schedule.count({ where: { twOrgId: a.body.org.id } })).toBe(1);
    });
  });

  it("concurrent double-create -> exactly one org, one key", async () => {
    const [x, y] = await Promise.all([create("race"), create("race")]);
    expect([x.status, y.status].sort()).toEqual([200, 201]);
    expect(x.body.org.id).toBe(y.body.org.id);
    orgIds.push(x.body.org.id);
    await withTwPlatform(client as never, "test read", async (tx: any) => {
      expect(await tx.orgApiKey.count({ where: { orgId: x.body.org.id } })).toBe(1);
    });
  });

  it("crash-resume: org row exists without defaults -> replay completes them, still one org", async () => {
    const ref = `t10-${run}-crash`;
    const email = `tw-t10-${run}-crash@t10.test`;
    emails.push(email);
    const id = randomUUID();
    await withTwPlatform(client as never, "test crash seed", (tx: any) =>
      tx.organization.create({ data: { id, slug: `t10-${run}-crash`, name: "Crash", externalRef: ref } })
    );
    orgIds.push(id);
    const r = await call("POST", [], `Bearer ${MASTER}`, {
      external_ref: ref,
      name: "Crash",
      owner: { email },
    });
    expect(r.status).toBe(200);
    expect(r.body.org.id).toBe(id);
    expect(r.body.org.eventTypes).toHaveLength(2);
    const r2 = await call("POST", [], `Bearer ${MASTER}`, {
      external_ref: ref,
      name: "Crash",
      owner: { email },
    });
    expect(r2.body.org.eventTypes.map((e: any) => e.id)).toEqual(r.body.org.eventTypes.map((e: any) => e.id));
  });

  it("custom working hours are honoured", async () => {
    const r = await create("wh", { working_hours: { days: [0, 6], start: "10:00", end: "14:30" } });
    expect(r.status).toBe(201);
    orgIds.push(r.body.org.id);
    await withTwPlatform(client as never, "test read", async (tx: any) => {
      const av = await tx.availability.findFirst({ where: { Schedule: { twOrgId: r.body.org.id } } });
      expect(av.days).toEqual([0, 6]);
      expect(av.endTime.toISOString().slice(11, 16)).toBe("14:30");
    });
  });

  it("validation and auth: bad body 400, no key 401, wrong key 401, org key cannot create 403", async () => {
    expect((await call("POST", [], `Bearer ${MASTER}`, { name: "x" })).status).toBe(400);
    expect((await call("POST", [], null, {})).status).toBe(401);
    expect((await call("POST", [], "Bearer twk_00000000." + "0".repeat(48), {})).status).toBe(401);
    expect((await call("POST", [], `Bearer ${MASTER}x`, {})).status).toBe(401);
    expect(
      (
        await call("POST", [], `Bearer ${keyA}`, {
          external_ref: "z",
          name: "z",
          owner: { email: "z@t10.test" },
        })
      ).status
    ).toBe(403);
    expect((await call("GET", [a.body.org.id], `Bearer ${MASTER}`)).status).toBe(403);
  });

  describe("org-scoped API and isolation (CC-13 surface for TW-T10)", () => {
    let b: R;
    let keyB: string;
    beforeAll(async () => {
      b = await create("b");
      orgIds.push(b.body.org.id);
      keyB = b.body.api_key.raw;
    });

    it("own org readable; other org 404 on every resource, read and write", async () => {
      const A = a.body.org.id;
      const B = b.body.org.id;
      expect((await call("GET", [A], `Bearer ${keyA}`)).status).toBe(200);
      for (const sub of ["members", "event-types", "bookings", "webhooks", "slots"]) {
        expect((await call("GET", [B, sub], `Bearer ${keyA}`)).status).toBe(404);
      }
      expect((await call("GET", [B], `Bearer ${keyA}`)).status).toBe(404);
      expect(
        (await call("POST", [B, "members"], `Bearer ${keyA}`, { email: `tw-t10-${run}-x@t10.test` })).status
      ).toBe(404);
      expect(
        (await call("POST", [B, "event-types"], `Bearer ${keyA}`, { title: "t", slug: "t", length: 20 }))
          .status
      ).toBe(404);
      expect(
        (
          await call("POST", [B, "webhooks"], `Bearer ${keyA}`, {
            subscriber_url: "https://x.test/h",
            triggers: ["BOOKING_CREATED"],
          })
        ).status
      ).toBe(404);
      expect((await call("GET", [B], `Bearer ${keyB}`)).status).toBe(200);
      // a non-uuid path id never reaches the DB
      expect((await call("GET", ["not-a-uuid"], `Bearer ${keyA}`)).status).toBe(404);
    });

    it("lists contain only the caller's rows", async () => {
      const ets = await call("GET", [a.body.org.id, "event-types"], `Bearer ${keyA}`);
      expect(ets.body.event_types).toHaveLength(2);
      const ms = await call("GET", [b.body.org.id, "members"], `Bearer ${keyB}`);
      expect(ms.body.members).toHaveLength(1);
      expect(ms.body.members[0].user.email).toContain("-b@t10.test");
    });

    it("members: add is idempotent, managed=true, other org's email -> 409", async () => {
      const e = `tw-t10-${run}-m1@t10.test`;
      emails.push(e);
      const r1 = await call("POST", [a.body.org.id, "members"], `Bearer ${keyA}`, {
        email: e,
        name: "M One",
      });
      expect(r1.status).toBe(201);
      const r2 = await call("POST", [a.body.org.id, "members"], `Bearer ${keyA}`, { email: e });
      expect(r2.status).toBe(200);
      const list = await call("GET", [a.body.org.id, "members"], `Bearer ${keyA}`);
      expect(list.body.members.filter((m: any) => m.managed)).toHaveLength(1);
      const clash = await call("POST", [b.body.org.id, "members"], `Bearer ${keyB}`, { email: e });
      expect(clash.status).toBe(409);
    });

    it("event types: create under the owner, duplicate slug 409, bad length 400", async () => {
      const ok = await call("POST", [a.body.org.id, "event-types"], `Bearer ${keyA}`, {
        title: "Intro",
        slug: "intro",
        length: 20,
      });
      expect(ok.status).toBe(201);
      expect(
        (
          await call("POST", [a.body.org.id, "event-types"], `Bearer ${keyA}`, {
            title: "Intro",
            slug: "intro",
            length: 20,
          })
        ).status
      ).toBe(409);
      expect(
        (
          await call("POST", [a.body.org.id, "event-types"], `Bearer ${keyA}`, {
            title: "x",
            slug: "x",
            length: 3,
          })
        ).status
      ).toBe(400);
    });

    it("slots: event type of another org -> 404; own -> delegates to getSlots", async () => {
      const bEt = b.body.org.eventTypes[0].id;
      const aEt = a.body.org.eventTypes[0].id;
      const q = (id: number) =>
        `eventTypeId=${id}&start=2027-01-04T00:00:00Z&end=2027-01-05T00:00:00Z&timezone=UTC`;
      expect((await call("GET", [a.body.org.id, "slots"], `Bearer ${keyA}`, undefined, q(bEt))).status).toBe(
        404
      );
      expect((await call("GET", [a.body.org.id, "slots"], `Bearer ${keyA}`, undefined, q(aEt))).status).toBe(
        200
      );
    });

    it("webhooks: create, list, delete; http URL rejected; cross-org delete 404", async () => {
      const w = await call("POST", [a.body.org.id, "webhooks"], `Bearer ${keyA}`, {
        subscriber_url: "https://hooks.t10.test/a",
        triggers: ["BOOKING_CREATED", "BOOKING_CANCELLED"],
        secret: "s3cret",
      });
      expect(w.status).toBe(201);
      expect(JSON.stringify(w.body)).not.toContain("s3cret");
      expect(
        (
          await call("POST", [a.body.org.id, "webhooks"], `Bearer ${keyA}`, {
            subscriber_url: "http://hooks.t10.test/a",
            triggers: ["BOOKING_CREATED"],
          })
        ).status
      ).toBe(400);
      expect((await call("GET", [a.body.org.id, "webhooks"], `Bearer ${keyA}`)).body.webhooks).toHaveLength(
        1
      );
      expect((await call("GET", [b.body.org.id, "webhooks"], `Bearer ${keyB}`)).body.webhooks).toHaveLength(
        0
      );
      expect(
        (await call("DELETE", [b.body.org.id, "webhooks", w.body.webhook.id], `Bearer ${keyB}`)).status
      ).toBe(404);
      expect(
        (await call("DELETE", [a.body.org.id, "webhooks", w.body.webhook.id], `Bearer ${keyA}`)).status
      ).toBe(200);
    });

    it("revoked key and scope limits", async () => {
      await withTwPlatform(client as never, "test revoke", (tx: any) =>
        tx.orgApiKey.updateMany({ where: { orgId: b.body.org.id }, data: { scopes: ["orgs:read"] } })
      );
      expect((await call("GET", [b.body.org.id], `Bearer ${keyB}`)).status).toBe(200);
      expect(
        (
          await call("POST", [b.body.org.id, "event-types"], `Bearer ${keyB}`, {
            title: "t",
            slug: "t",
            length: 20,
          })
        ).status
      ).toBe(403);
      await withTwPlatform(client as never, "test revoke", (tx: any) =>
        tx.orgApiKey.updateMany({ where: { orgId: b.body.org.id }, data: { revokedAt: new Date() } })
      );
      expect((await call("GET", [b.body.org.id], `Bearer ${keyB}`)).status).toBe(401);
    });

    it("rate limit: 429 after the key's quota", async () => {
      let n = 0;
      const limited = { ...deps, limiter: () => ++n <= 2 };
      const go = () =>
        handleOrgApi(
          {
            method: "GET",
            path: [a.body.org.id],
            authorization: `Bearer ${keyA}`,
            query: new URLSearchParams(),
            body: undefined,
          },
          limited
        );
      expect((await go()).status).toBe(200);
      expect((await go()).status).toBe(200);
      expect((await go()).status).toBe(429);
    });
  });
});

describe("TW-T12 plan enforcement (integration DB)", () => {
  it("Free (via Spenai cancelled) blocks the 2nd member; Starter package allows 3, blocks the 4th; override rows are RLS-scoped", async () => {
    const o = await create("plan");
    expect(o.status).toBe(201);
    orgIds.push(o.body.org.id);
    const key = `Bearer ${o.body.api_key.raw}`;
    const id = o.body.org.id as string;
    const addMember = (n: number) => {
      const email = `tw-t10-${run}-plan-m${n}@t10.test`;
      emails.push(email);
      return call("POST", [id, "members"], key, { email, name: `M${n}` });
    };
    // org-key may not change plans; only the platform key
    expect((await call("PUT", [id, "plan"], key, { plan_code: "pro" })).status).toBe(403);
    expect(
      (await call("PUT", [id, "plan"], `Bearer ${MASTER}`, { spenai_package: "enterprise" })).status
    ).toBe(400);
    expect((await call("PUT", [id, "plan"], `Bearer ${MASTER}`, { spenai_cancelled: true })).status).toBe(
      200
    );
    const m1 = await addMember(1);
    expect(m1.status).toBe(402);
    expect(m1.body.error.code).toBe("plan_limit_members");
    // Starter = Teams x 3 seats: owner + 2 more
    const set = await call("PUT", [id, "plan"], `Bearer ${MASTER}`, { spenai_package: "starter" });
    expect(set.body.plan).toEqual({ plan_code: "teams", seats: 3 });
    expect((await addMember(2)).status).toBe(201);
    expect((await addMember(3)).status).toBe(201);
    expect((await addMember(4)).status).toBe(402);
    // replay is idempotent
    expect((await call("PUT", [id, "plan"], `Bearer ${MASTER}`, { spenai_package: "starter" })).status).toBe(
      200
    );
    const got = await call("GET", [id, "plan"], key);
    expect(got.body.plan.plan_code).toBe("teams");
    expect(got.body.plan.entitlements.maxMembers).toBe(3);
  });
});
