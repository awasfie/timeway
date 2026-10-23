/**
 * CC-13 job probes (WC-TW-7c-5). Cron handlers run for real against the integration DB with tenants A and B
 * seeded; outbound email and HTTP are captured. Pass = A's rows produce only A's recipients / subscribers,
 * B's only B's, and neither tenant's rows are touched by the other's run.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { createWebhookHeaders } from "@calcom/features/webhooks/lib/webhookSignature";
import { prisma } from "@calcom/prisma";
import { BookingStatus, ReminderType } from "@calcom/prisma/enums";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Cc13Seed, SeededTenant } from "./seed";
import { seedCc13Tenants } from "./seed";

type Sent = { kind: string; uid: string; to: string };
const sent: Sent[] = [];

vi.mock("@calcom/emails/templates/booking-reminder-email", () => {
  class AttendeeBookingReminderEmail {
    constructor(
      private evt: { uid: string },
      private attendee: { email: string }
    ) {}
    async sendEmail() {
      sent.push({ kind: "attendee", uid: this.evt.uid, to: this.attendee.email });
    }
  }
  class HostBookingReminderEmail {
    constructor(
      private input: {
        calEvent: { uid: string; organizer: { email: string } };
        teamMember?: { email: string };
      }
    ) {}
    async sendEmail() {
      const { calEvent, teamMember } = this.input;
      sent.push({ kind: "host", uid: calEvent.uid, to: teamMember?.email ?? calEvent.organizer.email });
    }
  }
  return { AttendeeBookingReminderEmail, HostBookingReminderEmail };
});

vi.mock("@calcom/emails/email-manager", () => ({
  sendOrganizerRequestReminderEmail: async (evt: {
    uid: string;
    organizer: { email: string };
    attendees: { email: string }[];
  }) => {
    sent.push({ kind: "organizer-request", uid: evt.uid, to: evt.organizer.email });
    for (const a of evt.attendees)
      sent.push({ kind: "organizer-request-attendee", uid: evt.uid, to: a.email });
  },
}));

const CRON_KEY = "cc13-cron-key";
const cronRequest = (path: string) =>
  new NextRequest(`http://localhost/api/cron/${path}`, {
    method: "POST",
    headers: { authorization: CRON_KEY },
  });

let seed: Cc13Seed;
const tag = (t: SeededTenant) => `cc13-${seed.runId}-${t.label.toLowerCase()}`;
const ownsAddress = (t: SeededTenant, email: string) => email.startsWith(tag(t));

const reminderBookingIds: number[] = [];
const pending: Record<"A" | "B", { id: number; uid: string }> = {
  A: { id: 0, uid: "" },
  B: { id: 0, uid: "" },
};
const soon: Record<"A" | "B", { id: number; uid: string }> = {
  A: { id: 0, uid: "" },
  B: { id: 0, uid: "" },
};
const hookUrl = (t: SeededTenant) => `https://${tag(t)}-sched.cc13.invalid/hook`;

beforeAll(async () => {
  process.env.CRON_API_KEY = CRON_KEY;
  seed = await seedCc13Tenants();
  const now = Date.now();
  for (const t of [seed.A, seed.B]) {
    const l = t.label;
    // team event type with both of the tenant's users as hosts
    for (const u of [t.owner, t.member]) {
      await prisma.host.create({ data: { userId: u.id, eventTypeId: t.eventType.id, isFixed: true } });
    }
    // an ACCEPTED booking 30 minutes out (24 h and 1 h reminder windows) and a PENDING one awaiting confirmation
    const mk = async (suffix: string, status: BookingStatus, startOffsetMin: number) => {
      const start = new Date(now + startOffsetMin * 60_000);
      return prisma.booking.create({
        data: {
          uid: `${tag(t)}-${suffix}`,
          title: `CC-13 ${l} ${suffix}`,
          startTime: start,
          endTime: new Date(start.getTime() + 30 * 60_000),
          createdAt: new Date(now - 4 * 24 * 3_600_000),
          user: { connect: { id: t.owner.id } },
          eventType: { connect: { id: t.eventType.id } },
          status,
          twOrgId: t.twOrg.id,
          attendees: {
            create: [{ email: `${tag(t)}-${suffix}-guest@cc13.test`, name: `${l} guest`, timeZone: "UTC" }],
          },
        },
        select: { id: true, uid: true },
      });
    };
    soon[l] = await mk("soon", BookingStatus.ACCEPTED, 30);
    pending[l] = await mk("pending", BookingStatus.PENDING, 5 * 24 * 60);
    reminderBookingIds.push(soon[l].id, pending[l].id);
  }
});

afterAll(async () => {
  await prisma.reminderMail.deleteMany({ where: { referenceId: { in: reminderBookingIds } } });
  await seed?.cleanup();
});

beforeEach(() => {
  sent.length = 0;
});

const mine = (t: SeededTenant) => sent.filter((s) => s.uid.startsWith(tag(t)));

describe("CC-13 job probes: booking reminders (B vs A)", () => {
  it("sendBookingReminders sends A's reminders only to A's host, hosts and attendees and B's only to B's", async () => {
    const { POST } = await import("../../app/api/cron/sendBookingReminders/route");
    const res = await POST(cronRequest("sendBookingReminders"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);

    for (const t of [seed.A, seed.B]) {
      const other = t.label === "A" ? seed.B : seed.A;
      const got = sent.filter((s) => s.uid === soon[t.label].uid);
      // the booking was reminded: attendee + organizer + the other host (24 h and 1 h windows)
      const recipients = new Set(got.map((s) => s.to));
      expect(recipients.has(`${tag(t)}-soon-guest@cc13.test`)).toBe(true);
      expect(recipients.has(t.owner.email)).toBe(true);
      expect(recipients.has(t.member.email)).toBe(true);
      for (const r of recipients) {
        expect(ownsAddress(t, r), `${t.label} reminder went to ${r}`).toBe(true);
        expect(ownsAddress(other, r)).toBe(false);
      }
    }
    // no mail for any tenant booking carries another tenant's address
    for (const s of sent) {
      const owner = [seed.A, seed.B].find((t) => s.uid.startsWith(tag(t)));
      if (owner) expect(ownsAddress(owner, s.to), `${s.uid} -> ${s.to}`).toBe(true);
    }
    // the dedupe ledger rows reference only the tenants' own booking ids
    const ledger = await prisma.reminderMail.findMany({
      where: { reminderType: ReminderType.BOOKING_REMINDER, referenceId: { in: reminderBookingIds } },
      select: { referenceId: true },
    });
    expect(new Set(ledger.map((l) => l.referenceId))).toEqual(new Set([soon.A.id, soon.B.id]));
  });

  it("bookingReminder (pending confirmation) mails A's organizer and attendee for A's booking and B's for B's", async () => {
    const { POST } = await import("../../app/api/cron/bookingReminder/route");
    const res = await POST(cronRequest("bookingReminder"), { params: Promise.resolve({}) });
    expect(res.status).toBe(200);

    for (const t of [seed.A, seed.B]) {
      const got = sent.filter((s) => s.uid === pending[t.label].uid);
      expect(got.map((g) => g.to).sort()).toEqual(
        [t.owner.email, `${tag(t)}-pending-guest@cc13.test`].sort()
      );
    }
    const other = (t: SeededTenant) => (t.label === "A" ? seed.B : seed.A);
    for (const t of [seed.A, seed.B]) {
      for (const s of mine(t)) expect(ownsAddress(other(t), s.to)).toBe(false);
    }
    const ledger = await prisma.reminderMail.findMany({
      where: {
        reminderType: ReminderType.PENDING_BOOKING_CONFIRMATION,
        referenceId: { in: reminderBookingIds },
      },
      select: { referenceId: true },
    });
    expect(new Set(ledger.map((l) => l.referenceId))).toEqual(new Set([pending.A.id, pending.B.id]));
  });
});

describe("CC-13 job probes: webhook triggers (B vs A)", () => {
  it("webhookTriggers delivers A's scheduled trigger only to A's subscriber, signed with A's secret, and B's only to B's", async () => {
    const payloads: Record<"A" | "B", string> = {
      A: JSON.stringify({ triggerEvent: "BOOKING_REMINDER", payload: { uid: seed.A.booking.uid } }),
      B: JSON.stringify({ triggerEvent: "BOOKING_REMINDER", payload: { uid: seed.B.booking.uid } }),
    };
    for (const t of [seed.A, seed.B]) {
      await prisma.webhook.update({ where: { id: t.webhook.id }, data: { subscriberUrl: hookUrl(t) } });
      await prisma.webhookScheduledTriggers.create({
        data: {
          subscriberUrl: hookUrl(t),
          payload: payloads[t.label],
          startAfter: new Date(Date.now() - 60_000),
          webhookId: t.webhook.id,
          bookingId: t.booking.id,
        },
      });
    }
    const secrets = new Map<string, string | null>();
    for (const t of [seed.A, seed.B]) {
      const w = await prisma.webhook.findUniqueOrThrow({
        where: { id: t.webhook.id },
        select: { secret: true },
      });
      secrets.set(t.label, w.secret);
    }
    const aBefore = await prisma.webhook.findUniqueOrThrow({ where: { id: seed.A.webhook.id } });

    const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      // only capture this run's tenants; let nothing out to the network
      calls.push({
        url: u,
        body: String(init?.body),
        headers: (init?.headers ?? {}) as Record<string, string>,
      });
      return new Response("ok");
    });
    try {
      const { POST } = await import("../../app/api/cron/webhookTriggers/route");
      const res = await POST(cronRequest("webhookTriggers"), { params: Promise.resolve({}) });
      expect(res.status).toBe(200);
    } finally {
      fetchSpy.mockRestore();
    }

    for (const t of [seed.A, seed.B]) {
      const other = t.label === "A" ? seed.B : seed.A;
      const toMe = calls.filter((c) => c.url === hookUrl(t));
      expect(toMe).toHaveLength(1);
      expect(toMe[0].body).toBe(payloads[t.label]);
      expect(toMe[0].body).not.toContain(other.booking.uid);
      const expected = createWebhookHeaders({ secret: secrets.get(t.label), body: payloads[t.label] });
      expect(toMe[0].headers["X-Cal-Signature-256"]).toBe(expected["X-Cal-Signature-256"]);
      const otherSig = createWebhookHeaders({ secret: secrets.get(other.label), body: payloads[t.label] });
      expect(toMe[0].headers["X-Cal-Signature-256"]).not.toBe(otherSig["X-Cal-Signature-256"]);
    }
    // each tenant's subscriber URL received exactly its own booking's payload, nothing else of this run
    const tenantCalls = calls.filter((c) => c.url.includes(`cc13-${seed.runId}-`));
    expect(tenantCalls).toHaveLength(2);
    // A's webhook config is unchanged by the job run, and both triggers were consumed
    const aAfter = await prisma.webhook.findUniqueOrThrow({ where: { id: seed.A.webhook.id } });
    expect(aAfter).toEqual(aBefore);
    const left = await prisma.webhookScheduledTriggers.count({
      where: { bookingId: { in: [seed.A.booking.id, seed.B.booking.id] } },
    });
    expect(left).toBe(0);
  });
});

describe("CC-13 job probes: downgradeUsers and scheduleEmailReminders", () => {
  // .github/workflows/cron-downgradeUsers.yml and cron-scheduleEmailReminders.yml curl
  // /api/cron/downgradeUsers and /api/cron/workflows/scheduleEmailReminders. This fork carries neither
  // handler, so the jobs touch no tenant data. The probe fails the moment a handler appears, forcing a real
  // A-vs-B probe before it can ship.
  it("downgradeUsers and scheduleEmailReminders have no handler in this repo, so no tenant data is reachable", () => {
    const root = resolve(__dirname, "../../app/api/cron");
    for (const rel of [
      "downgradeUsers/route.ts",
      "workflows/scheduleEmailReminders/route.ts",
      "../../../../apps/web/pages/api/cron/downgradeUsers.ts",
      "../../../../apps/web/pages/api/cron/workflows/scheduleEmailReminders.ts",
    ]) {
      expect(existsSync(resolve(root, rel)), rel).toBe(false);
    }
  });
});
