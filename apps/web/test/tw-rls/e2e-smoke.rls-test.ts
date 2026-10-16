/**
 * TW-T9.2b5 (WC-30 step 5, CC-13): e2e smoke of six entry points as timeway_app
 * (NOSUPERUSER NOBYPASSRLS, owns nothing, DATABASE_POOL_MAX=1) with the TW-T9.2d FORCE RLS
 * migration applied. Two orgs A and B are seeded through an admin connection with mirror
 * data; every flow runs the real entry point and asserts the A result and that no B row
 * is read or written.
 *
 * Mocked: external I/O only (email/SMS sending, the calendar provider adapter, Next's
 * request-scoped cookie store). Prisma, the org-context extension and the definer
 * resolvers are real.
 *
 * Env (CI `rls` job): DATABASE_URL = timeway_app, DATABASE_POOL_MAX=1,
 * RLS_ADMIN_DATABASE_URL = a role that may seed across orgs. Missing env FAILS the suite.
 */
import { randomUUID } from "node:crypto";
import process from "node:process";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => ({ emails: [] as string[], csrf: "c".repeat(64) }));

vi.mock("@calcom/emails/email-manager", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const stubbed: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(actual)) {
    stubbed[name] =
      typeof value === "function" && name.startsWith("send")
        ? async () => {
            sent.emails.push(name);
          }
        : value;
  }
  return stubbed;
});

vi.mock("next/headers", () => {
  const jar = new Map<string, string>([["calcom.csrf_token", sent.csrf]]);
  return {
    cookies: async () => ({
      get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k) } : undefined),
      getAll: () => Array.from(jar.entries()).map(([name, value]) => ({ name, value })),
      has: (k: string) => jar.has(k),
      delete: (k: string) => jar.delete(k),
      set: (k: string, v: string) => jar.set(k, v),
    }),
    headers: async () => new Headers(),
  };
});

const ADMIN_URL = process.env.RLS_ADMIN_DATABASE_URL;
const PASSWORD = "smoke-Pass-1234!";

type Org = "A" | "B";
type Seed = {
  org: string;
  userId: number;
  email: string;
  username: string;
  teamSlug: string;
  userEventTypeId: number;
  teamEventTypeId: number;
  bookingUid: string;
  bookingId: number;
  credentialId: number;
  channelId: string;
  selectedCalendarId: string;
};

function tomorrowAt(hourUtc: number, minute = 0): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 2);
  d.setUTCHours(hourUtc, minute, 0, 0);
  return d;
}

describe("TW-T9.2b5 e2e smoke as timeway_app with FORCE RLS (6 flows)", () => {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  const tag = randomUUID().slice(0, 8);
  const seed = {} as Record<Org, Seed>;
  const teamIds: number[] = [];
  const allUserIds: number[] = [];

  /** Every row the smoke may have written, by org, read with the admin role (bypasses nothing: platform flag). */
  const bookingsOf = async (userId: number) =>
    (
      await admin.query(
        `select id, uid, status, "twOrgId", "eventTypeId" from "Booking" where "userId" = $1 order by id`,
        [userId]
      )
    ).rows as { id: number; uid: string; status: string; twOrgId: string | null; eventTypeId: number }[];

  beforeAll(async () => {
    expect(ADMIN_URL, "RLS_ADMIN_DATABASE_URL must be set; this suite is never skipped").toBeTruthy();
    expect(process.env.DATABASE_POOL_MAX).toBe("1");
    const { rows: who } = await admin
      .connect()
      .then(() => admin.query("select current_user"))
      .then((r) => r);
    expect(who[0].current_user).not.toBe("timeway_app");
    // The smoke only means something with FORCE RLS on and the app pool as timeway_app.
    const { rows: forced } = await admin.query(
      `select count(*)::int as n from pg_class where relnamespace = 'public'::regnamespace
         and relname in ('users','EventType','Booking','Schedule','Credential') and relrowsecurity and relforcerowsecurity`
    );
    expect(forced[0].n).toBe(5);
    const { prisma } = await import("@calcom/prisma");
    const [app] = await prisma.$queryRaw<{ u: string; su: boolean; br: boolean }[]>`
      select current_user::text as u, r.rolsuper as su, r.rolbypassrls as br from pg_roles r where r.rolname = current_user`;
    expect(app).toEqual({ u: "timeway_app", su: false, br: false });

    const { hashPassword } = await import("@calcom/lib/auth/hashPassword");
    const hash = await hashPassword(PASSWORD);

    await admin.query("begin");
    await admin.query("select set_config('app.tw_platform', 'on', true)");
    await admin.query(
      `insert into "Feature" (slug, enabled, type) values ('calendar-subscription-cache', true, 'OPERATIONAL')
       on conflict (slug) do update set enabled = true`
    );
    for (const o of ["A", "B"] as Org[]) {
      const org = randomUUID();
      const k = `${o.toLowerCase()}-${tag}`;
      await admin.query(
        `insert into tw_organization (id, slug, name, "updatedAt") values ($1, $2, $3, now())`,
        [org, `smoke-${k}`, `Smoke ${o}`]
      );
      const one = async (sql: string, params: unknown[]) => (await admin.query(sql, params)).rows[0].id;
      const email = `smoke-${k}@rls.invalid`;
      const username = `smoke-${k}`;
      const userId: number = await one(
        `insert into users (email, username, name, uuid, "twOrgId", "timeZone", "emailVerified", "completedOnboarding")
         values ($1, $2, $3, gen_random_uuid(), $4, 'UTC', now(), true) returning id`,
        [email, username, `Smoke ${o}`, org]
      );
      allUserIds.push(userId);
      await admin.query(`insert into "UserPassword" (hash, "userId") values ($1, $2)`, [hash, userId]);
      const scheduleId: number = await one(
        `insert into "Schedule" ("userId", name, "timeZone", "twOrgId") values ($1, 'smoke', 'UTC', $2) returning id`,
        [userId, org]
      );
      await admin.query(
        `insert into "Availability" ("scheduleId", days, "startTime", "endTime")
         values ($1, '{0,1,2,3,4,5,6}', '00:00', '23:59')`,
        [scheduleId]
      );
      await admin.query(`update users set "defaultScheduleId" = $1 where id = $2`, [scheduleId, userId]);
      const teamSlug = `smoke-team-${k}`;
      const teamId: number = await one(`insert into "Team" (name, slug) values ($1, $2) returning id`, [
        `Smoke team ${o}`,
        teamSlug,
      ]);
      teamIds.push(teamId);
      await admin.query(
        `insert into "Membership" ("teamId", "userId", accepted, role) values ($1, $2, true, 'OWNER')`,
        [teamId, userId]
      );
      const userEventTypeId: number = await one(
        `insert into "EventType" (title, slug, length, "userId", "scheduleId", "twOrgId")
         values ('Smoke 30', 'smoke-30', 30, $1, $2, $3) returning id`,
        [userId, scheduleId, org]
      );
      await admin.query(`insert into "_user_eventtype" ("A", "B") values ($1, $2)`, [
        userEventTypeId,
        userId,
      ]);
      const teamEventTypeId: number = await one(
        `insert into "EventType" (title, slug, length, "teamId", "schedulingType", "scheduleId", "twOrgId")
         values ('Smoke team 30', 'smoke-team-30', 30, $1, 'collective', $2, $3) returning id`,
        [teamId, scheduleId, org]
      );
      await admin.query(
        `insert into "Host" ("userId", "eventTypeId", "isFixed", "scheduleId") values ($1, $2, true, $3)`,
        [userId, teamEventTypeId, scheduleId]
      );
      const bookingUid = `smoke-cancel-${k}`;
      const bookingId: number = await one(
        `insert into "Booking" (uid, title, "startTime", "endTime", "userId", "eventTypeId", status, "twOrgId")
         values ($1, 'Smoke seeded', $2, $3, $4, $5, 'accepted', $6) returning id`,
        [bookingUid, tomorrowAt(20), tomorrowAt(20, 30), userId, userEventTypeId, org]
      );
      await admin.query(
        `insert into "Attendee" (email, name, "timeZone", "bookingId") values ($1, 'Guest', 'UTC', $2)`,
        [`guest-${k}@rls.invalid`, bookingId]
      );
      // The webhook calendar belongs to a second, non-host user of the org, so the booking
      // flows' availability check does not try to reach Google with this stub credential.
      const calUserId: number = await one(
        `insert into users (email, username, uuid, "twOrgId") values ($1, $2, gen_random_uuid(), $3) returning id`,
        [`smoke-cal-${k}@rls.invalid`, `smoke-cal-${k}`, org]
      );
      allUserIds.push(calUserId);
      const credentialId: number = await one(
        `insert into "Credential" (type, key, "userId", "appId", "twOrgId")
         values ('google_calendar', '{}', $1, null, $2) returning id`,
        [calUserId, org]
      );
      const channelId = `smoke-channel-${k}`;
      const selectedCalendarId: string = await one(
        `insert into "SelectedCalendar" (id, "userId", integration, "externalId", "credentialId", "channelId")
         values (gen_random_uuid()::text, $1, 'google_calendar', $2, $3, $4) returning id`,
        [calUserId, `cal-${k}@group.calendar.google.com`, credentialId, channelId]
      );
      seed[o] = {
        org,
        userId,
        email,
        username,
        teamSlug,
        userEventTypeId,
        teamEventTypeId,
        bookingUid,
        bookingId,
        credentialId,
        channelId,
        selectedCalendarId,
      };
    }
    await admin.query("commit");
  });

  afterAll(async () => {
    if (!seed.A) return;
    await admin.query("begin");
    await admin.query("select set_config('app.tw_platform', 'on', true)");
    const userIds = allUserIds;
    const orgs = [seed.A?.org, seed.B?.org].filter(Boolean);
    await admin.query(
      `delete from "CalendarCacheEvent" where "selectedCalendarId" in (select id from "SelectedCalendar" where "userId" = any($1))`,
      [userIds]
    );
    await admin.query(`delete from "SelectedCalendar" where "userId" = any($1)`, [userIds]);
    await admin.query(
      `delete from "Attendee" where "bookingId" in (select id from "Booking" where "userId" = any($1))`,
      [userIds]
    );
    await admin.query(`delete from "Booking" where "userId" = any($1)`, [userIds]);
    await admin.query(`delete from "Credential" where "userId" = any($1)`, [userIds]);
    await admin.query(`delete from "Host" where "userId" = any($1)`, [userIds]);
    await admin.query(`delete from "EventType" where "userId" = any($1) or "teamId" = any($2)`, [
      userIds,
      teamIds,
    ]);
    await admin.query(`delete from "Membership" where "teamId" = any($1)`, [teamIds]);
    await admin.query(`delete from "Team" where id = any($1)`, [teamIds]);
    await admin.query(`update users set "defaultScheduleId" = null where id = any($1)`, [userIds]);
    await admin.query(
      `delete from "Availability" where "scheduleId" in (select id from "Schedule" where "userId" = any($1))`,
      [userIds]
    );
    await admin.query(`delete from "Schedule" where "userId" = any($1)`, [userIds]);
    await admin.query(`delete from users where id = any($1)`, [userIds]);
    await admin.query(`delete from tw_organization where id = any($1)`, [orgs]);
    await admin.query("commit");
    await admin.end();
    const { prisma } = await import("@calcom/prisma");
    await prisma.$disconnect();
  });

  it("(1) login: authorizeCredentials returns A's user in A's org; B's password does not open A", async () => {
    const { authorizeCredentials } = await import("@calcom/features/auth/lib/next-auth-options");
    const user = await authorizeCredentials({
      email: seed.A.email,
      password: PASSWORD,
      totpCode: "",
      backupCode: "",
    });
    expect(user).toMatchObject({ id: seed.A.userId, email: seed.A.email, twOrgId: seed.A.org });
    expect(user?.id).not.toBe(seed.B.userId);
    await expect(
      authorizeCredentials({ email: seed.A.email, password: "wrong-password", totpCode: "", backupCode: "" })
    ).rejects.toThrow();
  });

  it("(2) own event types: tRPC viewer.eventTypes.list in A's session lists A's only", async () => {
    const { createCallerFactory, router } = await import("@calcom/trpc/server/trpc");
    const { eventTypesRouter } = await import("@calcom/trpc/server/routers/viewer/eventTypes/_router");
    const caller = createCallerFactory(router({ eventTypes: eventTypesRouter }))({
      session: {
        user: { id: seed.A.userId, email: seed.A.email, twOrgId: seed.A.org },
        upId: `usr-${seed.A.userId}`,
        expires: new Date(Date.now() + 3_600_000).toISOString(),
      },
      locale: "en",
    } as never);
    const list = (await caller.eventTypes.list()) as { id: number }[];
    const ids = list.map((e) => e.id);
    expect(ids).toEqual([seed.A.userEventTypeId]);
    expect(ids).not.toContain(seed.B.userEventTypeId);
    expect(ids).not.toContain(seed.B.teamEventTypeId);

    // A session naming B's org for A's user sees no A rows: the user lookup is empty, so UNAUTHORIZED.
    const forged = createCallerFactory(router({ eventTypes: eventTypesRouter }))({
      session: {
        user: { id: seed.A.userId, email: seed.A.email, twOrgId: seed.B.org },
        upId: `usr-${seed.A.userId}`,
        expires: new Date(Date.now() + 3_600_000).toISOString(),
      },
      locale: "en",
    } as never);
    await expect(forged.eventTypes.list()).rejects.toThrow(/UNAUTHORIZED/);
  });

  const book = async (user: string, eventTypeId: number, eventTypeSlug: string, hour: number) => {
    const { default: handler } = await import("@calcom/web/pages/api/book/event");
    const { createMocks } = await import("node-mocks-http");
    const { req, res } = createMocks({
      method: "POST",
      headers: { host: "app.cal.local:3000" },
      body: {
        eventTypeId,
        eventTypeSlug,
        user,
        start: tomorrowAt(hour).toISOString(),
        end: tomorrowAt(hour, 30).toISOString(),
        timeZone: "UTC",
        language: "en",
        metadata: {},
        hasHashedBookingLink: false,
        responses: {
          email: `booker-${tag}@rls.invalid`,
          name: "Smoke Booker",
          location: { optionValue: "", value: "integrations:daily" },
        },
      },
    });
    await handler(req as never, res as never);
    return { status: res._getStatusCode(), body: res._getJSONData?.() ?? res._getData() };
  };

  it("(3) public user booking: POST /api/book/event with user = A's username books into A", async () => {
    const before = await bookingsOf(seed.B.userId);
    const r = await book(seed.A.username, seed.A.userEventTypeId, "smoke-30", 9);
    expect(r.status, JSON.stringify(r.body).slice(0, 600)).toBe(200);
    const rows = await bookingsOf(seed.A.userId);
    const made = rows.find((b) => b.uid === r.body.uid);
    expect(made).toMatchObject({ twOrgId: seed.A.org, eventTypeId: seed.A.userEventTypeId });
    expect(await bookingsOf(seed.B.userId)).toEqual(before);
    // B's event type id under A's username: resolved to A, B's row is invisible -> no booking.
    const cross = await book(seed.A.username, seed.B.userEventTypeId, "smoke-30", 10);
    expect(cross.status).not.toBe(200);
    expect(await bookingsOf(seed.B.userId)).toEqual(before);
  });

  it("(4) public team booking: the same handler with A's team slug books into A", async () => {
    const before = await bookingsOf(seed.B.userId);
    const r = await book(seed.A.teamSlug, seed.A.teamEventTypeId, "smoke-team-30", 11);
    expect(r.status, JSON.stringify(r.body).slice(0, 600)).toBe(200);
    const made = (await bookingsOf(seed.A.userId)).find((b) => b.uid === r.body.uid);
    expect(made).toMatchObject({ twOrgId: seed.A.org, eventTypeId: seed.A.teamEventTypeId });
    expect(await bookingsOf(seed.B.userId)).toEqual(before);
  });

  it("(5) cancel by uid: /api/cancel cancels A's booking in A; B's booking is untouched", async () => {
    const { POST } = await import("@calcom/web/app/api/cancel/route");
    const { NextRequest } = await import("next/server");
    const req = new NextRequest("http://app.cal.local:3000/api/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uid: seed.A.bookingUid, csrfToken: sent.csrf, cancellationReason: "smoke" }),
    });
    const res = await POST(req, { params: Promise.resolve({}) });
    const body = await res.json();
    expect(res.status, JSON.stringify(body).slice(0, 600)).toBe(200);
    expect(body.success).toBe(true);
    const a = (await bookingsOf(seed.A.userId)).find((b) => b.uid === seed.A.bookingUid);
    expect(a?.status).toBe("cancelled");
    const b = (await bookingsOf(seed.B.userId)).find((x) => x.uid === seed.B.bookingUid);
    expect(b?.status).toBe("accepted");
  });

  it("(6) calendar webhook: processWebhook with selectedCalendarTwOrgScope caches A's events in A only", async () => {
    const { CalendarSubscriptionService } = await import(
      "@calcom/features/calendar-subscription/lib/CalendarSubscriptionService"
    );
    const { CalendarCacheEventRepository } = await import(
      "@calcom/features/calendar-subscription/lib/cache/CalendarCacheEventRepository"
    );
    const { CalendarCacheEventService } = await import(
      "@calcom/features/calendar-subscription/lib/cache/CalendarCacheEventService"
    );
    const { CalendarSyncService } = await import(
      "@calcom/features/calendar-subscription/lib/sync/CalendarSyncService"
    );
    const { BookingRepository } = await import("@calcom/features/bookings/repositories/BookingRepository");
    const { SelectedCalendarRepository } = await import(
      "@calcom/features/selectedCalendar/repositories/SelectedCalendarRepository"
    );
    const { getFeatureRepository } = await import("@calcom/features/di/containers/FeatureRepository");
    const { getTeamFeatureRepository } = await import("@calcom/features/di/containers/TeamFeatureRepository");
    const { getUserFeatureRepository } = await import("@calcom/features/di/containers/UserFeatureRepository");
    const { selectedCalendarTwOrgScope } = await import("@calcom/lib/server/tw-org-scope/unattended");
    const { prisma } = await import("@calcom/prisma");

    const fetched: { credentialId: number; userId: number | null }[] = [];
    const start = tomorrowAt(15);
    const end = tomorrowAt(16);
    // The provider adapter is the external calendar API: stubbed. Everything below it is real.
    const adapter = {
      validate: async () => true,
      extractChannelId: async (r: Request) => r.headers.get("x-goog-channel-id"),
      fetchEvents: async (_sc: unknown, credential: { id: number; userId: number | null }) => {
        fetched.push({ credentialId: credential.id, userId: credential.userId });
        return {
          provider: "google_calendar",
          syncToken: `tok-${tag}`,
          items: [
            {
              id: `evt-${tag}`,
              iCalUID: `evt-${tag}@google.com`,
              start,
              end,
              busy: true,
              summary: "smoke busy",
              status: "confirmed",
              isAllDay: false,
              timeZone: "UTC",
              recurringEventId: null,
              originalStartDate: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              etag: "e1",
              kind: "calendar#event",
            },
          ],
        };
      },
      subscribe: async () => ({}),
      unsubscribe: async () => undefined,
    };
    const service = new CalendarSubscriptionService({
      adapterFactory: { get: () => adapter, getProviders: () => ["google_calendar"] } as never,
      selectedCalendarRepository: new SelectedCalendarRepository(prisma),
      featureRepository: getFeatureRepository(),
      teamFeatureRepository: getTeamFeatureRepository(),
      userFeatureRepository: getUserFeatureRepository(),
      calendarSyncService: new CalendarSyncService({ bookingRepository: new BookingRepository(prisma) }),
      calendarCacheEventService: new CalendarCacheEventService({
        calendarCacheEventRepository: new CalendarCacheEventRepository(prisma),
      }),
      twOrgScope: selectedCalendarTwOrgScope(prisma),
    });
    const isCacheEnabledForUser = vi.spyOn(service, "isCacheEnabledForUser").mockResolvedValue(true);

    const req = new Request("http://app.cal.local:3000/api/webhooks/calendar-subscription/google_calendar", {
      method: "POST",
      headers: { "x-goog-channel-id": seed.A.channelId },
    });
    await service.processWebhook("google_calendar", req);
    isCacheEnabledForUser.mockRestore();

    expect(fetched.map((f) => f.credentialId)).toEqual([seed.A.credentialId]);
    const { rows: sc } = await admin.query(
      `select id, "syncToken" from "SelectedCalendar" where id = any($1) order by id`,
      [[seed.A.selectedCalendarId, seed.B.selectedCalendarId]]
    );
    const byId = Object.fromEntries(
      sc.map((r: { id: string; syncToken: string | null }) => [r.id, r.syncToken])
    );
    expect(byId[seed.A.selectedCalendarId]).toBe(`tok-${tag}`);
    expect(byId[seed.B.selectedCalendarId]).toBeNull();
    const { rows: cache } = await admin.query(
      `select "selectedCalendarId" from "CalendarCacheEvent" where "externalId" = $1`,
      [`evt-${tag}`]
    );
    expect(cache.map((r: { selectedCalendarId: string }) => r.selectedCalendarId)).toEqual([
      seed.A.selectedCalendarId,
    ]);
  });
});
