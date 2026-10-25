/**
 * CC-13 (extended) tRPC probes, WC-TW-7b: tenant B's session against tenant A's data through the
 * viewer routers. A probe passes when B is denied (NOT_FOUND/FORBIDDEN/UNAUTHORIZED or an empty
 * result) AND A's row is unchanged afterwards. Write probes use a fresh A-owned row so a leak
 * cannot poison the next probe.
 */
import { randomUUID } from "node:crypto";
import process from "node:process";
import { BookingStatus, WebhookTriggerEvents } from "@calcom/prisma/enums";
import { withTwPlatform } from "@calcom/prisma/tw-org-context";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Cc13Seed, SeededTenant } from "./seed";
import { seedCc13Tenants } from "./seed";
import { attempt, expectDenied, expectUnchanged, prisma, viewerFor } from "./trpc-harness";

let seed: Cc13Seed;
let viewerB: Awaited<ReturnType<typeof viewerFor>>;
let n = 0;
const credentialIds: number[] = [];
const tag = (t: SeededTenant) => `cc13-${seed.runId}-${t.label.toLowerCase()}`;

const mkEventType = (t: SeededTenant) =>
  prisma.eventType.create({
    data: {
      title: `${tag(t)} fx`,
      slug: `${tag(t)}-fx${++n}`,
      length: 30,
      teamId: t.team.id,
      twOrgId: t.twOrg.id,
      scheduleId: t.schedule.id,
    },
    select: { id: true },
  });

const mkBooking = (t: SeededTenant, status: BookingStatus = BookingStatus.ACCEPTED) => {
  const start = new Date(Date.UTC(2030, 1, 1 + n, 9));
  return prisma.booking.create({
    data: {
      uid: `${tag(t)}-fxb${++n}`,
      title: `${tag(t)} fx booking`,
      startTime: start,
      endTime: new Date(start.getTime() + 30 * 60_000),
      user: { connect: { id: t.owner.id } },
      eventType: { connect: { id: t.eventType.id } },
      status,
      twOrgId: t.twOrg.id,
      attendees: {
        create: { email: `${tag(t)}-guest${n}@cc13.test`, name: `${tag(t)} guest`, timeZone: "UTC" },
      },
    },
    select: { id: true, uid: true },
  });
};

/** A's booking with one seat: getBookingAttendees looks a booking up by seat reference uid. */
const mkSeat = async (t: SeededTenant) => {
  const b = await mkBooking(t);
  const attendee = await prisma.attendee.findFirstOrThrow({
    where: { bookingId: b.id },
    select: { id: true },
  });
  return prisma.bookingSeat.create({
    data: { referenceUid: randomUUID(), bookingId: b.id, attendeeId: attendee.id },
    select: { referenceUid: true },
  });
};

const mkSchedule = (t: SeededTenant) =>
  prisma.schedule.create({
    data: { name: `${tag(t)} fx${++n}`, userId: t.owner.id, timeZone: "UTC", twOrgId: t.twOrg.id },
    select: { id: true },
  });

const mkWebhook = (t: SeededTenant) =>
  prisma.webhook.create({
    data: {
      id: `${tag(t)}-fxwh${++n}`,
      teamId: t.team.id,
      subscriberUrl: `https://${tag(t)}.cc13.invalid/fx`,
      eventTriggers: [WebhookTriggerEvents.BOOKING_CREATED],
    },
    select: { id: true },
  });

const mkApiKey = (t: SeededTenant) =>
  prisma.apiKey.create({
    data: { userId: t.owner.id, teamId: t.team.id, note: tag(t), hashedKey: randomUUID() },
    select: { id: true },
  });

const mkCredential = async (t: SeededTenant) => {
  const c = await prisma.credential.create({
    data: { type: "cc13_probe", key: {}, userId: t.owner.id, teamId: t.team.id, twOrgId: t.twOrg.id },
    select: { id: true },
  });
  credentialIds.push(c.id);
  return c;
};

beforeAll(async () => {
  process.env.TW_CUSTOM_DOMAINS_ENABLED = "true";
  seed = await seedCc13Tenants();
  viewerB = await viewerFor(seed.B.owner.id);
});

afterAll(async () => {
  await prisma.credential.deleteMany({ where: { id: { in: credentialIds } } });
  await seed?.cleanup();
});

const noRows = (v: unknown) => Array.isArray(v) && v.length === 0;

describe("CC-13 tRPC: tenant B vs tenant A (WC-TW-7b)", () => {
  describe("eventTypes", () => {
    it("viewer.eventTypes.get: B cannot read A's event type", async () => {
      const o = await attempt(() => viewerB.eventTypes.get({ id: seed.A.eventType.id } as never));
      expectDenied(o, (v) => !(v as { eventType?: unknown } | null)?.eventType);
    });

    it("viewer.eventTypes.delete: B cannot delete A's event type", async () => {
      const fx = await mkEventType(seed.A);
      const read = () => prisma.eventType.findUnique({ where: { id: fx.id } });
      await expectUnchanged(read, async () => {
        expectDenied(await attempt(() => viewerB.eventTypes.delete({ id: fx.id })));
      });
    });

    it("viewer.eventTypesHeavy.update: B cannot edit A's event type", async () => {
      const fx = await mkEventType(seed.A);
      const read = () => prisma.eventType.findUnique({ where: { id: fx.id } });
      await expectUnchanged(read, async () => {
        expectDenied(
          await attempt(() => viewerB.eventTypesHeavy.update({ id: fx.id, title: "hijacked by B" } as never))
        );
      });
    });

    it("viewer.eventTypes.getEventTypesFromGroup: B cannot list A's team event types", async () => {
      const o = await attempt(() =>
        viewerB.eventTypes.getEventTypesFromGroup({ group: { teamId: seed.A.team.id }, limit: 10 } as never)
      );
      expectDenied(o, (v) => noRows((v as { eventTypes?: unknown }).eventTypes), {
        code: "INTERNAL_SERVER_ERROR",
        // The repository's membership check throws ErrorWithCode(Unauthorized), which tRPC wraps as INTERNAL_SERVER_ERROR.
        message: /User is not a member of this team/,
      });
    });
  });

  describe("bookings", () => {
    it("viewer.bookings.getBookingDetails: B gets nothing of A's booking", async () => {
      const o = await attempt(() => viewerB.bookings.getBookingDetails({ uid: seed.A.booking.uid }));
      expectDenied(o, (v) => {
        const d = v as {
          rescheduledToBooking?: unknown;
          previousBooking?: unknown;
          tracking?: unknown;
        } | null;
        return !d || (!d.rescheduledToBooking && !d.previousBooking && !d.tracking);
      });
    });

    it("viewer.bookings.getBookingAttendees: B cannot list A's booking attendees", async () => {
      const seat = await mkSeat(seed.A);
      const o = await attempt(() =>
        viewerB.bookings.getBookingAttendees({ seatReferenceUid: seat.referenceUid })
      );
      // The handler returns A's seat count: any number handed to B is a read of A's booking.
      expectDenied(o, (v) => v === null || v === undefined);
    });

    it("viewer.bookings.getBookingHistory: B cannot read A's booking audit log", async () => {
      expectDenied(
        await attempt(() => viewerB.bookings.getBookingHistory({ bookingUid: seed.A.booking.uid } as never))
      );
    });

    it("viewer.bookings.get: B's booking list contains none of A's bookings", async () => {
      const o = await attempt(() =>
        viewerB.bookings.get({ limit: 50, offset: 0, filters: { status: "upcoming" } } as never)
      );
      expectDenied(o, (v) => {
        const rows = (v as { bookings?: { uid: string }[] }).bookings ?? [];
        return !rows.some((b) => b.uid.startsWith(`cc13-${seed.runId}-a`));
      });
    });

    it("viewer.bookings.confirm: B cannot confirm A's pending booking", async () => {
      const fx = await mkBooking(seed.A, BookingStatus.PENDING);
      const read = () => prisma.booking.findUnique({ where: { id: fx.id } });
      await expectUnchanged(read, async () => {
        expectDenied(
          await attempt(() => viewerB.bookings.confirm({ bookingId: fx.id, confirmed: true } as never))
        );
      });
    });

    it("viewer.bookings.addGuests: B cannot add guests to A's booking", async () => {
      const fx = await mkBooking(seed.A);
      const read = async () => ({
        booking: await prisma.booking.findUnique({ where: { id: fx.id } }),
        attendees: await prisma.attendee.count({ where: { bookingId: fx.id } }),
      });
      await expectUnchanged(read, async () => {
        expectDenied(
          await attempt(() =>
            viewerB.bookings.addGuests({ bookingId: fx.id, guests: [{ email: "intruder@cc13.test" }] })
          )
        );
      });
    });

    it("viewer.bookings.requestReschedule: B cannot request reschedule of A's booking", async () => {
      const fx = await mkBooking(seed.A);
      const read = () => prisma.booking.findUnique({ where: { id: fx.id } });
      await expectUnchanged(read, async () => {
        expectDenied(await attempt(() => viewerB.bookings.requestReschedule({ bookingUid: fx.uid })));
      });
    });
  });

  describe("availability", () => {
    it("viewer.availability.schedule.get: B cannot read A's schedule", async () => {
      const o = await attempt(() =>
        viewerB.availability.schedule.get({ scheduleId: seed.A.schedule.id } as never)
      );
      expectDenied(o, (v) => !v);
    });

    it("viewer.availability.schedule.update: B cannot edit A's schedule", async () => {
      const fx = await mkSchedule(seed.A);
      const read = () => prisma.schedule.findUnique({ where: { id: fx.id } });
      await expectUnchanged(read, async () => {
        expectDenied(
          await attempt(() =>
            viewerB.availability.schedule.update({ scheduleId: fx.id, name: "hijacked by B" } as never)
          )
        );
      });
    });

    it("viewer.availability.schedule.delete: B cannot delete A's schedule", async () => {
      const fx = await mkSchedule(seed.A);
      const read = () => prisma.schedule.findUnique({ where: { id: fx.id } });
      await expectUnchanged(read, async () => {
        expectDenied(await attempt(() => viewerB.availability.schedule.delete({ scheduleId: fx.id })));
      });
    });

    it("viewer.availability.schedule.duplicate: B cannot duplicate A's schedule", async () => {
      const fx = await mkSchedule(seed.A);
      const read = async () => ({
        row: await prisma.schedule.findUnique({ where: { id: fx.id } }),
        copiesOwnedByB: await prisma.schedule.count({ where: { userId: seed.B.owner.id } }),
      });
      await expectUnchanged(read, async () => {
        // The handler's own UNAUTHORIZED is rethrown as INTERNAL_SERVER_ERROR by its catch-all;
        // the copy count of B and A's row (read above) prove nothing was duplicated.
        expectDenied(
          await attempt(() => viewerB.availability.schedule.duplicate({ scheduleId: fx.id } as never)),
          undefined,
          { code: "INTERNAL_SERVER_ERROR" }
        );
      });
    });
  });

  describe("webhook", () => {
    it("viewer.webhook.get: B cannot read A's webhook", async () => {
      const o = await attempt(() => viewerB.webhook.get({ webhookId: seed.A.webhook.id }));
      expectDenied(o, (v) => !v);
    });

    it("viewer.webhook.list: B cannot list A's team webhooks", async () => {
      const o = await attempt(() => viewerB.webhook.list({ teamId: seed.A.team.id } as never));
      expectDenied(o, noRows);
    });

    it("viewer.webhook.edit: B cannot edit A's webhook", async () => {
      const fx = await mkWebhook(seed.A);
      const read = () => prisma.webhook.findUnique({ where: { id: fx.id } });
      await expectUnchanged(read, async () => {
        expectDenied(
          await attempt(() =>
            viewerB.webhook.edit({
              id: fx.id,
              subscriberUrl: "https://attacker.cc13.invalid/steal",
              eventTriggers: [WebhookTriggerEvents.BOOKING_CREATED],
              active: false,
              payloadTemplate: null,
            } as never)
          )
        );
      });
    });

    it("viewer.webhook.delete: B cannot delete A's webhook", async () => {
      const fx = await mkWebhook(seed.A);
      const read = () => prisma.webhook.findUnique({ where: { id: fx.id } });
      await expectUnchanged(read, async () => {
        expectDenied(await attempt(() => viewerB.webhook.delete({ id: fx.id })), () => true);
      });
    });

    it("viewer.webhook.create: B cannot attach a webhook to A's team", async () => {
      const before = await prisma.webhook.count({ where: { teamId: seed.A.team.id } });
      const o = await attempt(() =>
        viewerB.webhook.create({
          subscriberUrl: "https://attacker.cc13.invalid/new",
          eventTriggers: [WebhookTriggerEvents.BOOKING_CREATED],
          active: true,
          payloadTemplate: null,
          teamId: seed.A.team.id,
        } as never)
      );
      // INTERNAL_SERVER_ERROR counts as a deny only together with A's unchanged webhook count below.
      expectDenied(o, undefined, { code: "INTERNAL_SERVER_ERROR" });
      expect(await prisma.webhook.count({ where: { teamId: seed.A.team.id } })).toBe(before);
    });
  });

  describe("apiKeys", () => {
    it("viewer.apiKeys.list: B's key list holds none of A's keys", async () => {
      const o = await attempt(() => viewerB.apiKeys.list());
      expectDenied(o, (v) => !(v as { id: string }[]).some((k) => k.id === seed.A.apiKey.id));
    });

    it("viewer.apiKeys.edit: B cannot edit A's API key", async () => {
      const fx = await mkApiKey(seed.A);
      const read = () => prisma.apiKey.findUnique({ where: { id: fx.id } });
      await expectUnchanged(read, async () => {
        expectDenied(await attempt(() => viewerB.apiKeys.edit({ id: fx.id, note: "hijacked by B" })));
      });
    });

    it("viewer.apiKeys.delete: B cannot delete A's API key", async () => {
      const fx = await mkApiKey(seed.A);
      const read = () => prisma.apiKey.findUnique({ where: { id: fx.id } });
      await expectUnchanged(read, async () => {
        // The handler deletes through B's own user.apiKeys relation, so Prisma refuses with
        // "records ... are not connected" (P2017); A's key surviving (read above) is the proof.
        expectDenied(await attempt(() => viewerB.apiKeys.delete({ id: fx.id })), undefined, {
          code: "INTERNAL_SERVER_ERROR",
          message: /are not connected/,
        });
      });
    });
  });

  describe("credentials", () => {
    it("viewer.credentials.delete: B cannot delete A's credential", async () => {
      const fx = await mkCredential(seed.A);
      const read = () =>
        prisma.credential.findUnique({
          where: { id: fx.id },
          select: { id: true, type: true, teamId: true, userId: true, twOrgId: true },
        });
      await expectUnchanged(read, async () => {
        expectDenied(await attempt(() => viewerB.credentials.delete({ id: fx.id })));
        expectDenied(await attempt(() => viewerB.credentials.delete({ id: fx.id, teamId: seed.A.team.id })));
      });
    });
  });

  describe("organizations.customDomain", () => {
    const hostRow = (orgId: string) => () =>
      withTwPlatform(prisma, "CC-13 probe read", (tx) =>
        tx.twCustomHostname.findUnique({ where: { orgId } })
      );

    it("viewer.organizations.customDomain.get: B cannot read A's org custom hostname", async () => {
      expectDenied(
        await attempt(() => viewerB.organizations.customDomain.get({ orgId: seed.A.twOrg.id } as never))
      );
    });

    it("viewer.organizations.customDomain.add and remove: B cannot change A's org custom hostname", async () => {
      await withTwPlatform(prisma, "CC-13 probe seed", (tx) =>
        tx.twCustomHostname.create({
          data: { orgId: seed.A.twOrg.id, hostname: `${tag(seed.A)}.cc13.invalid` },
        })
      );
      await expectUnchanged(hostRow(seed.A.twOrg.id), async () => {
        expectDenied(
          await attempt(() =>
            viewerB.organizations.customDomain.add({
              orgId: seed.A.twOrg.id,
              hostname: "stolen.cc13.invalid",
            } as never)
          )
        );
        expectDenied(
          await attempt(() => viewerB.organizations.customDomain.refresh({ orgId: seed.A.twOrg.id } as never))
        );
        expectDenied(
          await attempt(() => viewerB.organizations.customDomain.remove({ orgId: seed.A.twOrg.id } as never))
        );
      });
    });
  });
});
