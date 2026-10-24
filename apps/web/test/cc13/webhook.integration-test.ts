/**
 * CC-13 webhook probes (WC-TW-7c-4). Tenant B against tenant A's webhook config (web/tRPC handlers)
 * and A's booking events against B's subscriber URLs (real trigger path, captured fetch).
 * Pass = B gets a refusal / empty result AND A's row is unchanged; no delivery ever reaches B's URL.
 */
import { handleWebhookTrigger } from "@calcom/features/bookings/lib/handleWebhookTrigger";
import { getWebhookFeature } from "@calcom/features/di/webhooks/containers/webhook";
import getWebhooks from "@calcom/features/webhooks/lib/getWebhooks";
import { prisma } from "@calcom/prisma";
import { WebhookTriggerEvents } from "@calcom/prisma/enums";
import { webhookRouter } from "@calcom/trpc/server/routers/viewer/webhook/_router";
import { createCallerFactory } from "@calcom/trpc/server/trpc";
import type { TFunction } from "i18next";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { Cc13Seed, SeededTenant } from "./seed";
import { seedCc13Tenants } from "./seed";

let seed: Cc13Seed;
// extra config rows per tenant: a user-level and an event-type-level webhook
const extra: Record<"A" | "B", { userWebhookId: string; eventTypeWebhookId: string }> = {
  A: { userWebhookId: "", eventTypeWebhookId: "" },
  B: { userWebhookId: "", eventTypeWebhookId: "" },
};

const hookUrl = (t: SeededTenant, kind: string) => `https://${t.twOrg.slug}-${kind}.cc13.invalid/hook`;

beforeAll(async () => {
  seed = await seedCc13Tenants();
  for (const t of [seed.A, seed.B]) {
    const tag = `cc13-${seed.runId}-${t.label.toLowerCase()}`;
    extra[t.label] = { userWebhookId: `${tag}-uwh`, eventTypeWebhookId: `${tag}-ewh` };
    await prisma.webhook.create({
      data: {
        id: extra[t.label].userWebhookId,
        userId: t.owner.id,
        subscriberUrl: hookUrl(t, "user"),
        eventTriggers: [WebhookTriggerEvents.BOOKING_CREATED],
        secret: `${tag}-user-secret`,
      },
    });
    await prisma.webhook.create({
      data: {
        id: extra[t.label].eventTypeWebhookId,
        eventTypeId: t.eventType.id,
        subscriberUrl: hookUrl(t, "et"),
        eventTriggers: [WebhookTriggerEvents.BOOKING_CREATED],
        secret: `${tag}-et-secret`,
      },
    });
  }
  await snapshotA();
});

afterEach(async () => {
  await restoreA();
});

afterAll(async () => {
  await seed?.cleanup();
});

const createCaller = createCallerFactory(webhookRouter);
function callerFor(t: SeededTenant) {
  // ctx.session short-circuits getSession; the isAuthed middleware then loads the user from the DB.
  // biome-ignore lint/suspicious/noExplicitAny: the router only reads session + user from ctx
  const ctx: any = {
    session: {
      user: { id: t.owner.id },
      upId: `usr-${t.owner.id}`,
      hasValidLicense: true,
      expires: new Date(Date.now() + 3_600_000).toISOString(),
    },
  };
  return createCaller(ctx);
}

// A leak probe can mutate A's rows; restore them so later probes start from the seeded state.
const pristine = new Map<string, NonNullable<Awaited<ReturnType<typeof webhookRow>>>>();
async function snapshotA() {
  const { A } = seed;
  for (const id of [A.webhook.id, extra.A.userWebhookId, extra.A.eventTypeWebhookId]) {
    const row = await webhookRow(id);
    if (row) pristine.set(id, row);
  }
}
async function restoreA() {
  for (const [id, row] of Array.from(pristine)) {
    const { id: _id, ...data } = row;
    await prisma.webhook.upsert({ where: { id }, create: row, update: data });
  }
}
const webhookRow = (id: string) => prisma.webhook.findUnique({ where: { id } });
const bookingEventAsA = () => {
  const { A } = seed;
  return {
    subscriberOptions: {
      userId: A.owner.id,
      eventTypeId: A.eventType.id,
      triggerEvent: WebhookTriggerEvents.BOOKING_CREATED,
      teamId: A.team.id,
      orgId: A.team.id,
    },
    eventTrigger: WebhookTriggerEvents.BOOKING_CREATED,
    webhookData: {
      title: "CC-13 A booking",
      type: "meeting",
      startTime: "2030-01-15T09:00:00.000Z",
      endTime: "2030-01-15T09:30:00.000Z",
      uid: A.booking.uid,
      bookingId: A.booking.id,
      organizer: {
        name: "A",
        email: A.owner.email,
        timeZone: "UTC",
        language: { translate: ((key: string) => key) as TFunction, locale: "en" },
      },
      attendees: [],
    },
    traceContext: { traceId: "cc13", spanId: "cc13", operation: "cc13" },
  };
};

describe("CC-13 webhook probes: config isolation (web/tRPC)", () => {
  it("B list returns none of A's webhooks", async () => {
    const { A, B } = seed;
    const list = await callerFor(B).list({});
    const ids = list.map((w) => w.id);
    expect(ids).toContain(B.webhook.id);
    for (const id of [A.webhook.id, extra.A.userWebhookId, extra.A.eventTypeWebhookId]) {
      expect(ids).not.toContain(id);
    }
  });

  it("B getByViewer returns none of A's webhooks", async () => {
    const { A } = seed;
    const res = await callerFor(seed.B).getByViewer();
    const ids = JSON.stringify(res);
    for (const id of [A.webhook.id, extra.A.userWebhookId, extra.A.eventTypeWebhookId]) {
      expect(ids).not.toContain(id);
    }
  });

  it("B cannot read A's user and event-type webhook", async () => {
    const { A, B } = seed;
    for (const id of [extra.A.userWebhookId, extra.A.eventTypeWebhookId]) {
      const before = await webhookRow(id);
      await expect(callerFor(B).get({ id })).rejects.toMatchObject({
        code: expect.stringMatching(/FORBIDDEN|NOT_FOUND|UNAUTHORIZED/),
      });
      expect(await webhookRow(id)).toEqual(before);
    }
    expect(A.webhook.id).toBeTruthy();
  });

  // CC13-WH-001: webhook.get on a team-scoped webhook (teamId set, no userId/eventTypeId) skips every ownership check
  // in createWebhookProcedure and returns A's subscriberUrl and signing secret to B.
  it.fails("B cannot read A's team webhook", async () => {
    const { A, B } = seed;
    const before = await webhookRow(A.webhook.id);
    const res = await callerFor(B)
      .get({ id: A.webhook.id })
      .catch((e) => ({ error: e.code as string }));
    expect(res).toMatchObject({ error: expect.stringMatching(/FORBIDDEN|NOT_FOUND|UNAUTHORIZED/) });
    expect(await webhookRow(A.webhook.id)).toEqual(before);
  });

  it("B cannot edit A's user and event-type webhook", async () => {
    const { B } = seed;
    for (const id of [extra.A.userWebhookId, extra.A.eventTypeWebhookId]) {
      const before = await webhookRow(id);
      await expect(
        callerFor(B).edit({
          id,
          payloadTemplate: null,
          subscriberUrl: "https://attacker.cc13.invalid/x",
          active: false,
        })
      ).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND|UNAUTHORIZED/) });
      expect(await webhookRow(id)).toEqual(before);
    }
  });

  // CC13-WH-002: webhook.edit on a team-scoped webhook has no tenant check; B repoints A's subscriberUrl and deactivates it.
  it.fails("B cannot edit A's team webhook", async () => {
    const { A, B } = seed;
    const before = await webhookRow(A.webhook.id);
    const res = await callerFor(B)
      .edit({
        id: A.webhook.id,
        payloadTemplate: null,
        subscriberUrl: "https://attacker.cc13.invalid/x",
        active: false,
      })
      .catch((e) => ({ error: e.code as string }));
    expect(res).toMatchObject({ error: expect.stringMatching(/FORBIDDEN|NOT_FOUND|UNAUTHORIZED/) });
    expect(await webhookRow(A.webhook.id)).toEqual(before);
  });

  it("B cannot delete A's team, user and event-type webhook", async () => {
    const { A, B } = seed;
    const ids = [A.webhook.id, extra.A.userWebhookId, extra.A.eventTypeWebhookId];
    const before = await Promise.all(ids.map(webhookRow));
    for (const id of ids) {
      await callerFor(B)
        .delete({ id })
        .catch(() => undefined);
    }
    // also with B's own event type id as the scope hint
    await callerFor(B)
      .delete({ id: extra.A.eventTypeWebhookId, eventTypeId: B.eventType.id })
      .catch(() => undefined);
    await callerFor(B)
      .delete({ id: extra.A.eventTypeWebhookId, eventTypeId: A.eventType.id })
      .catch(() => undefined);
    expect(await Promise.all(ids.map(webhookRow))).toEqual(before);
  });

  it("B cannot create a webhook on A's event type", async () => {
    const { A, B } = seed;
    const countBefore = await prisma.webhook.count({ where: { eventTypeId: A.eventType.id } });
    await expect(
      callerFor(B).create({
        subscriberUrl: "https://attacker.cc13.invalid/new",
        eventTriggers: [WebhookTriggerEvents.BOOKING_CREATED],
        active: true,
        payloadTemplate: null,
        eventTypeId: A.eventType.id,
      })
    ).rejects.toMatchObject({ code: expect.stringMatching(/FORBIDDEN|NOT_FOUND|UNAUTHORIZED/) });
    expect(await prisma.webhook.count({ where: { eventTypeId: A.eventType.id } })).toBe(countBefore);
    expect(B.eventType.id).toBeTruthy();
  });
});

describe("CC-13 webhook probes: delivery (A's booking events vs B's subscriber URL)", () => {
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    calls.push(String(url));
    return new Response("ok", { status: 200 });
  });

  afterEach(() => {
    calls.length = 0;
    fetchMock.mockClear();
    vi.unstubAllGlobals();
  });

  const isB = (url: string) => url.includes(seed.B.twOrg.slug);

  it("A's booking event is delivered to A's subscribers and never to B's subscriber URLs", async () => {
    vi.stubGlobal("fetch", fetchMock);
    await handleWebhookTrigger(bookingEventAsA());
    // control: A's own three webhooks fire, so a missing B call is not a dead path
    expect(calls).toEqual(
      expect.arrayContaining([
        hookUrl(seed.A, "user"),
        hookUrl(seed.A, "et"),
        `https://${seed.A.twOrg.slug}.cc13.invalid/hook`,
      ])
    );
    expect(calls.filter(isB)).toEqual([]);
  });

  it("every booking trigger event for A stays away from B's subscriber URLs", async () => {
    vi.stubGlobal("fetch", fetchMock);
    const events = [
      WebhookTriggerEvents.BOOKING_CREATED,
      WebhookTriggerEvents.BOOKING_CANCELLED,
      WebhookTriggerEvents.BOOKING_RESCHEDULED,
      WebhookTriggerEvents.BOOKING_REQUESTED,
      WebhookTriggerEvents.BOOKING_REJECTED,
      WebhookTriggerEvents.MEETING_ENDED,
    ];
    // B subscribes to all of them, so a leak on any event shows up
    await prisma.webhook.updateMany({
      where: { id: { in: [seed.B.webhook.id, extra.B.userWebhookId, extra.B.eventTypeWebhookId] } },
      data: { eventTriggers: events },
    });
    const base = bookingEventAsA();
    for (const trigger of events) {
      await handleWebhookTrigger({
        ...base,
        eventTrigger: trigger,
        subscriberOptions: { ...base.subscriberOptions, triggerEvent: trigger },
      });
    }
    expect(calls.filter(isB)).toEqual([]);
  });

  it("getWebhooks for A's event type returns none of B's webhooks", async () => {
    const { A, B } = seed;
    const subs = await getWebhooks({
      userId: A.owner.id,
      eventTypeId: A.eventType.id,
      triggerEvent: WebhookTriggerEvents.BOOKING_CREATED,
      teamId: A.team.id,
      orgId: A.team.id,
    });
    const ids = subs.map((s) => s.id);
    expect(ids).toContain(A.webhook.id);
    for (const id of [B.webhook.id, extra.B.userWebhookId, extra.B.eventTypeWebhookId]) {
      expect(ids).not.toContain(id);
    }
  });

  it("WebhookRepository.getSubscribers for A's event type returns none of B's webhooks", async () => {
    const { A, B } = seed;
    const { repository } = getWebhookFeature();
    const subs = await repository.getSubscribers({
      userId: A.owner.id,
      eventTypeId: A.eventType.id,
      triggerEvent: WebhookTriggerEvents.BOOKING_CREATED,
      teamId: A.team.id,
      orgId: A.team.id,
    });
    const ids = subs.map((s) => s.id);
    expect(ids).toContain(A.webhook.id);
    for (const id of [B.webhook.id, extra.B.userWebhookId, extra.B.eventTypeWebhookId]) {
      expect(ids).not.toContain(id);
    }
  });

  it("an event with no team/org context for A still never reaches B", async () => {
    vi.stubGlobal("fetch", fetchMock);
    const base = bookingEventAsA();
    await handleWebhookTrigger({
      ...base,
      subscriberOptions: {
        userId: seed.A.owner.id,
        eventTypeId: seed.A.eventType.id,
        triggerEvent: WebhookTriggerEvents.BOOKING_CREATED,
        teamId: null,
        orgId: null,
      },
    });
    expect(calls.filter(isB)).toEqual([]);
    expect(calls).toContain(hookUrl(seed.A, "et"));
  });
});
