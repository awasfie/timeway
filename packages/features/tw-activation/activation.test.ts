import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@calcom/prisma", () => ({ default: {}, prisma: {} }));
vi.mock("@calcom/lib/trackServerEvent", () => ({ trackServerEvent: vi.fn() }));

import { trackServerEvent } from "@calcom/lib/trackServerEvent";

import type { ActivationClient, ActivationTx } from "./activation";
import {
  insertActivationEvent,
  isCalendarCredentialType,
  isExternalBooking,
  onBookingCreated,
  onCalendarCredentialCreated,
  recordActivationEvent,
} from "./activation";

const ORG = "6f1c2b1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b";

/** In-memory stand-in for tw_activation_event honouring UNIQUE(twOrgId, kind) + ON CONFLICT DO NOTHING. */
function fakeDb(opts: { memberEmails?: string[]; userOrg?: string | null } = {}) {
  const rows = new Map<string, { refId: unknown; occurredAt: unknown }>();
  const sql: string[] = [];
  const tx: ActivationTx = {
    $executeRaw: vi.fn(async (q: TemplateStringsArray, ...v: unknown[]) => {
      const text = q.join("?");
      sql.push(text);
      if (text.includes("set_config")) return 1;
      if (text.includes('INSERT INTO "tw_activation_event"')) {
        expect(text).toContain('ON CONFLICT ("twOrgId", "kind") DO NOTHING');
        const [, twOrgId, kind, occurredAt, refId] = v;
        const key = `${twOrgId}:${kind}`;
        if (rows.has(key)) return 0;
        rows.set(key, { refId, occurredAt });
        return 1;
      }
      throw new Error(`unexpected execute: ${text}`);
    }),
    $queryRaw: vi.fn(async (q: TemplateStringsArray, ...v: unknown[]) => {
      const text = q.join("?");
      sql.push(text);
      if (text.includes('FROM "tw_activation_event"')) {
        return rows.has(`${v[0]}:first_external_booking`) ? [{ one: 1 }] : [];
      }
      if (text.includes('FROM "tw_organization_member"')) {
        return (opts.memberEmails ?? []).map((email) => ({ email }));
      }
      throw new Error(`unexpected query: ${text}`);
    }) as ActivationTx["$queryRaw"],
  };
  const client: ActivationClient = {
    $transaction: vi.fn(async (fn) => fn(tx)) as ActivationClient["$transaction"],
    $queryRaw: vi.fn(async () => [{ twOrgId: opts.userOrg ?? null }]) as ActivationClient["$queryRaw"],
  };
  return { client, tx, rows, sql };
}

describe("isExternalBooking", () => {
  it("is external when no attendee is an org member", () => {
    expect(isExternalBooking(["guest@example.com"], ["owner@org.test"])).toBe(true);
  });
  it("is internal when any attendee is an org member (case/space-insensitive)", () => {
    expect(isExternalBooking(["guest@example.com", " Owner@Org.Test "], ["owner@org.test"])).toBe(false);
  });
  it("is not external with no attendees", () => {
    expect(isExternalBooking([], ["owner@org.test"])).toBe(false);
    expect(isExternalBooking(["", "  "], [])).toBe(false);
  });
  it("is external when the org has no members on record", () => {
    expect(isExternalBooking(["guest@example.com"], [])).toBe(true);
  });
});

describe("isCalendarCredentialType", () => {
  it("matches only *_calendar types", () => {
    expect(isCalendarCredentialType("google_calendar")).toBe(true);
    expect(isCalendarCredentialType("office365_calendar")).toBe(true);
    expect(isCalendarCredentialType("google_video")).toBe(false);
    expect(isCalendarCredentialType("weather_in_your_calendar_other")).toBe(false);
    expect(isCalendarCredentialType(undefined)).toBe(false);
  });
});

describe("first-wins insert", () => {
  it("inserts once per (org, kind); a second occurrence is a no-op and keeps the first refId", async () => {
    const { client, rows } = fakeDb();
    const first = await recordActivationEvent({ twOrgId: ORG, kind: "calendar_connected", refId: 11 }, client);
    const second = await recordActivationEvent({ twOrgId: ORG, kind: "calendar_connected", refId: 22 }, client);
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(rows.size).toBe(1);
    expect(rows.get(`${ORG}:calendar_connected`)?.refId).toBe("11");
  });

  it("sets the org RLS context before inserting, in the same transaction", async () => {
    const { client, sql } = fakeDb();
    await recordActivationEvent({ twOrgId: ORG, kind: "event_type_published", refId: 5 }, client);
    expect(sql[0]).toContain("set_config('app.tw_org_id'");
    expect(sql[1]).toContain('INSERT INTO "tw_activation_event"');
  });

  it("different kinds for one org each get a row", async () => {
    const { tx, rows } = fakeDb();
    const at = new Date("2026-10-21T00:00:00Z");
    await insertActivationEvent(tx, { twOrgId: ORG, kind: "calendar_connected", occurredAt: at, refId: "1" });
    await insertActivationEvent(tx, { twOrgId: ORG, kind: "event_type_published", occurredAt: at, refId: "2" });
    expect(rows.size).toBe(2);
  });

  it("rejects a non-UUID org id (withTwOrg guard) without touching the DB", async () => {
    const { client } = fakeDb();
    await expect(
      recordActivationEvent({ twOrgId: "not-a-uuid", kind: "calendar_connected" }, client)
    ).rejects.toThrow(/UUID/);
    expect(client.$transaction).not.toHaveBeenCalled();
  });
});

describe("hooks never fail the user action", () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  beforeEach(() => vi.mocked(trackServerEvent).mockClear());
  afterEach(() => warn.mockClear());

  it("onBookingCreated records first_external_booking once, and booking_confirmed every time", async () => {
    const db = fakeDb({ memberEmails: ["owner@org.test"] });
    const booking = { uid: "b1", status: "ACCEPTED", twOrgId: ORG, eventTypeId: 7, attendees: [{ email: "g@x.io" }] };
    await onBookingCreated(booking, "WEBAPP", db.client);
    await onBookingCreated({ ...booking, uid: "b2" }, "WEBAPP", db.client);
    expect(db.rows.get(`${ORG}:first_external_booking`)?.refId).toBe("b1");
    const names = vi.mocked(trackServerEvent).mock.calls.map((c) => c[0]);
    expect(names.filter((n) => n === "booking_confirmed")).toHaveLength(2);
    expect(names.filter((n) => n === "first_external_booking")).toHaveLength(1);
  });

  it("onBookingCreated ignores internal and non-ACCEPTED bookings", async () => {
    const db = fakeDb({ memberEmails: ["owner@org.test"] });
    await onBookingCreated(
      { uid: "i1", status: "ACCEPTED", twOrgId: ORG, attendees: [{ email: "OWNER@org.test" }] },
      "WEBAPP",
      db.client
    );
    await onBookingCreated(
      { uid: "p1", status: "PENDING", twOrgId: ORG, attendees: [{ email: "g@x.io" }] },
      "WEBAPP",
      db.client
    );
    expect(db.rows.size).toBe(0);
  });

  it("swallows DB errors", async () => {
    const db = fakeDb({ userOrg: ORG });
    vi.mocked(db.client.$transaction).mockRejectedValueOnce(new Error("db down"));
    await expect(
      onCalendarCredentialCreated({ id: 1, type: "google_calendar", userId: 3 }, "test", db.client)
    ).resolves.toBeUndefined();
  });

  it("calendar hook resolves the org from the credential owner and skips non-calendar credentials", async () => {
    const db = fakeDb({ userOrg: ORG });
    await onCalendarCredentialCreated({ id: 9, type: "zoom_video", userId: 3 }, "test", db.client);
    expect(db.rows.size).toBe(0);
    await onCalendarCredentialCreated({ id: 9, type: "google_calendar", userId: 3 }, "test", db.client);
    expect(db.rows.get(`${ORG}:calendar_connected`)?.refId).toBe("9");
  });
});
