/**
 * WC-TW-14f proof: CC-14 extended (sub-org idempotency), sandbox unbilled, billing attribution,
 * against a real local Postgres (never prod). Every row carries a per-run tag and is removed afterwards.
 * Prints PROOF lines (row counts, outbox lines) that docs/proof/wc-tw-14.md quotes.
 */
import { randomBytes, randomUUID } from "node:crypto";
import process from "node:process";
import { enqueueApiBookingUsage, enqueueManagedUserSnapshot } from "@calcom/features/payments/gateway/apiUsage";
import type { OrgApiClient } from "@calcom/features/tw-provisioning/orgApi";
import { handleOrgApi } from "@calcom/features/tw-provisioning/orgApi";
import { createSubOrg } from "@calcom/features/tw-provisioning/subOrgs";
import { prisma } from "@calcom/prisma";
import { withTwPlatform } from "@calcom/prisma/tw-org-context";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MASTER = `master-${randomBytes(16).toString("hex")}`;
const run = randomBytes(3).toString("hex");
const client = prisma as unknown as OrgApiClient;
const orgIds: string[] = [];
const deps = { client, getSlots: async () => ({ slots: {} }), limiter: () => true };
// biome-ignore lint/suspicious/noExplicitAny: test helper
type R = { status: number; body: any };
const call = (method: string, path: string[], authorization: string | null, body?: unknown): Promise<R> =>
  handleOrgApi({ method, path, authorization, query: new URLSearchParams(""), body }, deps) as Promise<R>;
const proof = (s: string) => console.log(`PROOF ${s}`);
// biome-ignore lint/suspicious/noExplicitAny: test helper
const plat = (why: string, fn: (tx: any) => Promise<any>): Promise<any> =>
  withTwPlatform(client as never, why, fn);

const mkOrg = async (ref: string) => {
  const r = await call("POST", [], `Bearer ${MASTER}`, {
    external_ref: `t14f-${run}-${ref}`,
    name: `T14f ${ref}`,
    slug: `t14f-${run}-${ref}`,
    owner: { email: `tw-14f-${run}-${ref}@t14f.test`, name: "Owner", timezone: "Asia/Dubai" },
  });
  expect([200, 201]).toContain(r.status);
  orgIds.push(r.body.org.id);
  return r;
};
const sub = (over: Record<string, unknown> = {}) => ({
  clientRef: "c1",
  name: "Client One",
  hideBranding: false,
  billingAttribution: "self" as const,
  ...over,
});
const addManaged = async (orgId: string, n: number) => {
  for (let i = 0; i < n; i++) {
    await plat("14f seed managed member", async (tx) => {
      const u = await tx.user.create({
        data: { email: `tw-14f-${run}-${randomUUID().slice(0, 8)}@t14f.test`, username: `u${randomUUID()}`, twOrgId: orgId },
      });
      await tx.organizationMember.create({ data: { orgId, userId: u.id, role: "member", managed: true } });
    });
  }
};
const seedBooking = (orgId: string, userId: number, uid: string) =>
  plat("14f seed API booking", (tx) =>
    tx.booking.create({
      data: {
        uid,
        title: "t14f",
        startTime: new Date("2027-01-04T10:00:00Z"),
        endTime: new Date("2027-01-04T10:30:00Z"),
        userId,
        twOrgId: orgId,
        creationSource: "API_V2",
      },
    })
  );
const ownerOf = (orgId: string) =>
  plat("14f owner", async (tx) => (await tx.organizationMember.findFirst({ where: { orgId, role: "owner" } })).userId as number);
const tasks = (where: object = {}) =>
  plat("14f tasks", (tx) =>
    tx.task.findMany({ where: { type: "timewayApiUsage", ...where }, orderBy: { createdAt: "asc" } })
  ) as Promise<{ payload: string; referenceUid: string }[]>;

beforeAll(() => {
  process.env.TW_PLATFORM_MASTER_KEY = MASTER;
  process.env.TW_API_USAGE_ENABLED = "true";
});

afterAll(async () => {
  await plat("WC-TW-14f cleanup", async (tx) => {
    const subs = await tx.organization.findMany({ where: { parentOrgId: { in: orgIds } }, select: { id: true } });
    const all = [...orgIds, ...subs.map((s: { id: string }) => s.id)];
    const users = await tx.user.findMany({ where: { twOrgId: { in: all } }, select: { id: true } });
    const ids = users.map((u: { id: number }) => u.id);
    await tx.task.deleteMany({ where: { type: "timewayApiUsage" } });
    await tx.booking.deleteMany({ where: { twOrgId: { in: all } } });
    await tx.webhook.deleteMany({ where: { userId: { in: ids } } });
    await tx.eventType.deleteMany({ where: { userId: { in: ids } } });
    await tx.schedule.deleteMany({ where: { userId: { in: ids } } });
    await tx.organizationMember.deleteMany({ where: { orgId: { in: all } } });
    await tx.orgEntitlementOverride?.deleteMany({ where: { orgId: { in: all } } });
    await tx.orgApiKey.deleteMany({ where: { orgId: { in: all } } });
    await tx.user.deleteMany({ where: { id: { in: ids } } });
    await tx.organization.deleteMany({ where: { id: { in: subs.map((s: { id: string }) => s.id) } } });
    await tx.organization.deleteMany({ where: { id: { in: orgIds } } });
  });
});

describe("step 1: CC-14 extended", () => {
  it("POST /api/v2/orgs same external_ref twice -> one org", async () => {
    const a = await mkOrg("one");
    const b = await mkOrg("one");
    expect([a.status, b.status]).toEqual([201, 200]);
    expect(b.body.org.id).toBe(a.body.org.id);
    const n = await plat("count", (tx) => tx.organization.count({ where: { externalRef: `t14f-${run}-one` } }));
    expect(n).toBe(1);
    proof(`step1a orgs POST x2 -> statuses ${a.status},${b.status}; same id; organization rows with that external_ref = ${n}`);
  });

  it("sub-org same clientRef twice and concurrently -> one row; different body -> 409", async () => {
    const p = (await mkOrg("par")).body.org.id as string;
    const key = (await call("POST", [], `Bearer ${MASTER}`, {
      external_ref: `t14f-${run}-par`, name: "T14f par", owner: { email: `tw-14f-${run}-par@t14f.test` },
    })).body.api_key; // replay: no key returned
    expect(key).toBeUndefined();
    const [x, y] = await Promise.all([createSubOrg(client as never, p, sub() as never), createSubOrg(client as never, p, sub() as never)]);
    expect(x.org.id).toBe(y.org.id);
    expect([x.created, y.created].sort()).toEqual([false, true]);
    const again = await createSubOrg(client as never, p, sub() as never);
    expect(again.created).toBe(false);
    const rows = await plat("count", (tx) => tx.organization.findMany({ where: { parentOrgId: p }, select: { externalRef: true } }));
    expect(rows).toHaveLength(1);
    expect(rows[0].externalRef).toBe(`sub:${p}:c1`);
    await expect(createSubOrg(client as never, p, sub({ name: "Different" }) as never)).rejects.toMatchObject({ status: 409 });
    const after = await plat("count", (tx) => tx.organization.count({ where: { parentOrgId: p } }));
    expect(after).toBe(1);
    proof(`step1b sub-org concurrent x2 + replay -> created flags [false,true]+false, rows with parent = ${after}, externalRef sub:<parent>:c1; different body -> 409`);
  });

  it("crash-resume: kill between org insert and default resources, replay completes", async () => {
    const ref = `t14f-${run}-crash`;
    const email = `tw-14f-${run}-crash@t14f.test`;
    const id = randomUUID();
    await plat("seed half-provisioned org (crash after org insert)", (tx) =>
      tx.organization.create({ data: { id, slug: `t14f-${run}-crash`, name: "Crash", externalRef: ref } })
    );
    orgIds.push(id);
    const count = async () =>
      plat("count", async (tx) => ({
        orgs: await tx.organization.count({ where: { externalRef: ref } }),
        members: await tx.organizationMember.count({ where: { orgId: id } }),
        schedules: await tx.schedule.count({ where: { twOrgId: id } }),
        eventTypes: await tx.eventType.count({ where: { twOrgId: id } }),
      }));
    const before = await count();
    expect(before).toEqual({ orgs: 1, members: 0, schedules: 0, eventTypes: 0 });
    const r = await call("POST", [], `Bearer ${MASTER}`, { external_ref: ref, name: "Crash", owner: { email } });
    expect(r.status).toBe(200);
    expect(r.body.org.id).toBe(id);
    const after = await count();
    expect(after).toEqual({ orgs: 1, members: 1, schedules: 1, eventTypes: 2 });
    await call("POST", [], `Bearer ${MASTER}`, { external_ref: ref, name: "Crash", owner: { email } });
    expect(await count()).toEqual(after);
    proof(`step1c crash-resume before ${JSON.stringify(before)} -> after replay ${JSON.stringify(after)}; second replay unchanged`);
  });
});

describe("steps 2-3: outbox", () => {
  it("sandbox org + sandbox child: managed users + API bookings -> zero outbox lines", async () => {
    const sb = (await mkOrg("sbx")).body.org.id as string;
    await plat("mark sandbox", (tx) => tx.organization.update({ where: { id: sb }, data: { isSandbox: true } }));
    const child = (await createSubOrg(client as never, sb, sub({ clientRef: "sbc", billingAttribution: "parent" }) as never)).org;
    const isSb = await plat("read", (tx) => tx.organization.findUnique({ where: { id: child.id }, select: { isSandbox: true } }));
    expect(isSb.isSandbox).toBe(true); // inherited
    await addManaged(sb, 3);
    await addManaged(child.id, 2);
    const owner = await ownerOf(sb);
    // the booking organizer must be a managed member of the booking org
    const mem = await plat("read", (tx) => tx.organizationMember.findFirst({ where: { orgId: sb, managed: true } }));
    const cm = await plat("read", (tx) => tx.organizationMember.findFirst({ where: { orgId: child.id, managed: true } }));
    void owner;
    const o1 = await (async () => { const u = `t14f-${run}-sb1`; await seedBooking(sb, mem.userId, u); return enqueueApiBookingUsage({ bookingUid: u }); })();
    const o2 = await (async () => { const u = `t14f-${run}-sb2`; await seedBooking(child.id, cm.userId, u); return enqueueApiBookingUsage({ bookingUid: u }); })();
    const snap = await enqueueManagedUserSnapshot();
    const lines = await tasks();
    const sbLines = lines.filter((l) => [sb, child.id].includes(JSON.parse(l.payload).billingOrgId) || [sb, child.id].includes(JSON.parse(l.payload).clientOrgId));
    expect(o1).toBe("unbilled");
    expect(o2).toBe("unbilled");
    expect(sbLines).toHaveLength(0);
    const members = await plat("count", (tx) => tx.organizationMember.count({ where: { orgId: { in: [sb, child.id] }, managed: true } }));
    proof(`step2 sandbox parent+child: managed members=${members}, API bookings=2 (outcomes ${o1},${o2}), snapshot=${JSON.stringify(snap)}, outbox lines for these orgs = ${sbLines.length}`);
  });

  it("parent-attributed sub-org: one snapshot + one API booking -> orgId=parent, clientOrgId=sub-org; resend counts once", async () => {
    const p = (await mkOrg("agency")).body.org.id as string;
    const c = (await createSubOrg(client as never, p, sub({ clientRef: "pc", billingAttribution: "parent" }) as never)).org;
    await addManaged(c.id, 1);
    const cm = await plat("read", (tx) => tx.organizationMember.findFirst({ where: { orgId: c.id, managed: true } }));
    const uid = `t14f-${run}-pbk`;
    await seedBooking(c.id, cm.userId, uid);
    const snap = await enqueueManagedUserSnapshot();
    const snap2 = await enqueueManagedUserSnapshot(); // same day, replay
    const b1 = await enqueueApiBookingUsage({ bookingUid: uid });
    const b2 = await enqueueApiBookingUsage({ bookingUid: uid }); // duplicate create path
    expect(b1).toBe("enqueued");
    expect(b2).toBe("duplicate");
    const mine = (await tasks()).map((t) => ({ ref: t.referenceUid, p: JSON.parse(t.payload) })).filter((l) => l.p.billingOrgId === p);
    expect(mine).toHaveLength(2);
    const mu = mine.find((l) => l.p.meter === "timeway_api_managed_user");
    const bk = mine.find((l) => l.p.meter === "timeway_api_booking");
    expect(mu?.p).toMatchObject({ billingOrgId: p, value: 1 });
    expect(mu?.p.clientOrgId).toBeUndefined(); // Gosi/passport#42: ONE line per billing org on the `last` meter
    expect(bk?.p).toMatchObject({ billingOrgId: p, clientOrgId: c.id, value: 1, ref: `bk:${uid}` });
    expect(snap2.enqueued).toBe(0);
    proof(`step3 outbox: ${mine.length} lines for billing org; mu=${JSON.stringify({ key: mu?.p.idempotencyKey, value: mu?.p.value, orgId: mu?.p.billingOrgId, clientOrgId: mu?.p.clientOrgId ?? null })}; bk=${JSON.stringify({ key: bk?.p.idempotencyKey, value: bk?.p.value, orgId: bk?.p.billingOrgId, clientOrgId: bk?.p.clientOrgId })}; snapshot rerun enqueued=${snap2.enqueued} dup=${snap2.duplicate}; booking replay outcome=${b2}; first snapshot=${JSON.stringify(snap)}`);
  });
});
