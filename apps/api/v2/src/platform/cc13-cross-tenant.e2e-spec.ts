import {
  CAL_API_VERSION_HEADER,
  VERSION_2024_06_11,
  VERSION_2024_06_14,
  VERSION_2024_08_13,
} from "@calcom/platform-constants";
import type { Booking, EventType, PlatformOAuthClient, Schedule, Team, User } from "@calcom/prisma/client";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { BookingsRepositoryFixture } from "test/fixtures/repository/bookings.repository.fixture";
import { EventTypesRepositoryFixture } from "test/fixtures/repository/event-types.repository.fixture";
import { OAuthClientRepositoryFixture } from "test/fixtures/repository/oauth-client.repository.fixture";
import { SchedulesRepositoryFixture } from "test/fixtures/repository/schedules.repository.fixture";
import { TeamRepositoryFixture } from "test/fixtures/repository/team.repository.fixture";
import { TokensRepositoryFixture } from "test/fixtures/repository/tokens.repository.fixture";
import { UserRepositoryFixture } from "test/fixtures/repository/users.repository.fixture";
import { randomString } from "test/utils/randomString";
import { mockThrottlerGuard } from "test/utils/withNoThrottler";
import { AppModule } from "@/app.module";
import { bootstrap } from "@/bootstrap";
import { PermissionsGuard } from "@/modules/auth/guards/permissions/permissions.guard";
import { PrismaModule } from "@/modules/prisma/prisma.module";
import { UsersModule } from "@/modules/users/users.module";

/**
 * CC-13 apiV2 probes, part 1 (WC-TW-7c-1): bookings, event-types, schedules.
 * Tenant B's OAuth client access token reads and writes tenant A's rows.
 * Pass = B gets 401/403/404 (or an empty/A-free list) AND A's row is unchanged.
 */
interface Tenant {
  label: "A" | "B";
  org: Team;
  client: PlatformOAuthClient;
  user: User;
  accessToken: string;
  eventType: EventType;
  schedule: Schedule;
  booking: Booking;
  pendingBooking: Booking;
  cancelBooking: Booking;
}

const DENIED = [401, 403, 404];
// 400 "does not belong to user" is a refusal that returns no data.
const DENIED_OR_BAD_REQUEST = [400, ...DENIED];

describe("CC-13 apiV2 cross-tenant probes: bookings, event-types, schedules", () => {
  let app: INestApplication;
  let bookingsFixture: BookingsRepositoryFixture;
  let eventTypesFixture: EventTypesRepositoryFixture;
  let schedulesFixture: SchedulesRepositoryFixture;
  let oauthFixture: OAuthClientRepositoryFixture;
  let teamFixture: TeamRepositoryFixture;
  let userFixture: UserRepositoryFixture;
  let tokensFixture: TokensRepositoryFixture;
  let A: Tenant;
  let B: Tenant;
  const tag = `cc13-api-${randomString()}`;

  async function seedTenant(label: "A" | "B"): Promise<Tenant> {
    const t = `${tag}-${label.toLowerCase()}`;
    const org = await teamFixture.create({ name: `${t}-org`, isOrganization: true });
    const client = await oauthFixture.create(
      org.id,
      { logo: "logo-url", name: `${t}-client`, redirectUris: ["http://localhost:5555"], permissions: 32 },
      "secret"
    );
    const user = await userFixture.create({
      email: `${t}@api.com`,
      username: t,
      name: t,
      platformOAuthClients: { connect: { id: client.id } },
    });
    const { accessToken } = await tokensFixture.createTokens(user.id, client.id);
    const schedule = await schedulesFixture.create({
      name: `${t}-schedule`,
      timeZone: "Europe/Rome",
      user: { connect: { id: user.id } },
    });
    const eventType = await eventTypesFixture.create(
      { title: `${t}-event-type`, slug: `${t}-event-type`, length: 30 },
      user.id
    );
    const mkBooking = (suffix: string, status: "ACCEPTED" | "PENDING", hour: number) =>
      bookingsFixture.create({
        uid: `${t}-${suffix}`,
        title: `${t}-${suffix}`,
        startTime: new Date(Date.UTC(2020, 0, 8, hour, 0, 0)),
        endTime: new Date(Date.UTC(2020, 0, 8, hour, 30, 0)),
        status,
        user: { connect: { id: user.id } },
        eventType: { connect: { id: eventType.id } },
        metadata: {},
        responses: { name: `${t}-attendee`, email: `${t}-attendee@example.com` },
        attendees: {
          create: { email: `${t}-attendee@example.com`, name: `${t}-attendee`, timeZone: "Europe/Rome" },
        },
      });
    const booking = await mkBooking("booking", "ACCEPTED", 10);
    const pendingBooking = await mkBooking("pending", "PENDING", 12);
    const cancelBooking = await mkBooking("cancel", "ACCEPTED", 14);
    return { label, org, client, user, accessToken, eventType, schedule, booking, pendingBooking, cancelBooking };
  }

  const bearer = (t: Tenant) => `Bearer ${t.accessToken}`;
  const bookingsReq = () => ({ [CAL_API_VERSION_HEADER]: VERSION_2024_08_13 });

  beforeAll(async () => {
    mockThrottlerGuard();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, PrismaModule, UsersModule],
    })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    bookingsFixture = new BookingsRepositoryFixture(moduleRef);
    eventTypesFixture = new EventTypesRepositoryFixture(moduleRef);
    schedulesFixture = new SchedulesRepositoryFixture(moduleRef);
    oauthFixture = new OAuthClientRepositoryFixture(moduleRef);
    teamFixture = new TeamRepositoryFixture(moduleRef);
    userFixture = new UserRepositoryFixture(moduleRef);
    tokensFixture = new TokensRepositoryFixture(moduleRef);

    A = await seedTenant("A");
    B = await seedTenant("B");

    app = moduleRef.createNestApplication();
    bootstrap(app as NestExpressApplication);
    await app.init();
  });

  afterAll(async () => {
    for (const t of [A, B]) {
      if (!t) continue;
      await bookingsFixture.deleteById(t.booking.id).catch(() => undefined);
      await bookingsFixture.deleteById(t.pendingBooking.id).catch(() => undefined);
      await bookingsFixture.deleteById(t.cancelBooking.id).catch(() => undefined);
      await eventTypesFixture.delete(t.eventType.id).catch(() => undefined);
      await schedulesFixture.deleteById(t.schedule.id).catch(() => undefined);
      await userFixture.deleteByEmail(t.user.email).catch(() => undefined);
      await oauthFixture.delete(t.client.id).catch(() => undefined);
      await teamFixture.delete(t.org.id).catch(() => undefined);
    }
    await app?.close();
  });

  describe("bookings (2024-08-13)", () => {
    const bookingUnchanged = async (b: Booking) => {
      const row = await bookingsFixture.getByUid(b.uid);
      expect(row).not.toBeNull();
      expect(row?.status).toEqual(b.status);
      expect(row?.title).toEqual(b.title);
      expect(row?.cancellationReason ?? null).toBeNull();
    };

    it("B list bookings returns none of A's bookings", async () => {
      const res = await request(app.getHttpServer())
        .get("/v2/bookings")
        .set("Authorization", bearer(B))
        .set(bookingsReq())
        .expect(200);
      const uids = (res.body.data as { uid: string }[]).map((b) => b.uid);
      expect(uids).not.toContain(A.booking.uid);
      expect(uids).not.toContain(A.pendingBooking.uid);
      expect(uids).toContain(B.booking.uid);
    });

    it("B cannot read A's booking references", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v2/bookings/${A.booking.uid}/references`)
        .set("Authorization", bearer(B))
        .set(bookingsReq());
      expect(DENIED_OR_BAD_REQUEST).toContain(res.status);
      await bookingUnchanged(A.booking);
    });

    // CC13-API-001: GET /v2/bookings/:uid/calendar-links returns A's booking title/times to B (any authenticated caller).
    it.failing("B cannot read A's booking calendar links", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v2/bookings/${A.booking.uid}/calendar-links`)
        .set("Authorization", bearer(B))
        .set(bookingsReq());
      expect(DENIED).toContain(res.status);
    });

    // CC13-API-004: POST /v2/bookings/:uid/mark-absent by B returns 200 on A's past booking (no tenant check beyond BookingUidGuard).
    it.failing("B cannot mark A's booking absent", async () => {
      const res = await request(app.getHttpServer())
        .post(`/v2/bookings/${A.booking.uid}/mark-absent`)
        .set("Authorization", bearer(B))
        .set(bookingsReq())
        .send({ host: true });
      expect(DENIED).toContain(res.status);
      const row = await bookingsFixture.getByUid(A.booking.uid);
      expect(row?.noShowHost ?? null).not.toEqual(true);
      await bookingUnchanged(A.booking);
    });

    it("B cannot confirm A's pending booking", async () => {
      const res = await request(app.getHttpServer())
        .post(`/v2/bookings/${A.pendingBooking.uid}/confirm`)
        .set("Authorization", bearer(B))
        .set(bookingsReq())
        .send({});
      expect(DENIED).toContain(res.status);
      await bookingUnchanged(A.pendingBooking);
    });

    it("B cannot decline A's pending booking", async () => {
      const res = await request(app.getHttpServer())
        .post(`/v2/bookings/${A.pendingBooking.uid}/decline`)
        .set("Authorization", bearer(B))
        .set(bookingsReq())
        .send({ reason: "cc13 probe" });
      expect(DENIED).toContain(res.status);
      await bookingUnchanged(A.pendingBooking);
    });

    it("B cannot reassign A's booking", async () => {
      const res = await request(app.getHttpServer())
        .post(`/v2/bookings/${A.booking.uid}/reassign/${B.user.id}`)
        .set("Authorization", bearer(B))
        .set(bookingsReq())
        .send({});
      expect(DENIED).toContain(res.status);
      const row = await bookingsFixture.getByUid(A.booking.uid);
      expect(row?.userId).toEqual(A.user.id);
      await bookingUnchanged(A.booking);
    });

    // CC13-API-003: POST /v2/bookings/:uid/cancel by B cancels A's booking (OptionalApiAuthGuard, no tenant check).
    it.failing("B cannot cancel A's booking", async () => {
      const res = await request(app.getHttpServer())
        .post(`/v2/bookings/${A.cancelBooking.uid}/cancel`)
        .set("Authorization", bearer(B))
        .set(bookingsReq())
        .send({ cancellationReason: "cc13 probe" });
      expect(DENIED).toContain(res.status);
      await bookingUnchanged(A.cancelBooking);
    });

    // CC13-API-002: GET /v2/bookings/:uid returns A's host email, attendees and details to B (uid acts as a bearer capability).
    it.failing("B cannot read A's booking by uid with attendee details", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v2/bookings/${A.booking.uid}`)
        .set("Authorization", bearer(B))
        .set(bookingsReq());
      expect(DENIED).toContain(res.status);
    });
  });

  describe("event-types (2024-06-14)", () => {
    const ev = () => ({ [CAL_API_VERSION_HEADER]: VERSION_2024_06_14 });
    const eventTypeUnchanged = async () => {
      const row = await eventTypesFixture.findById(A.eventType.id);
      expect(row).not.toBeNull();
      expect(row?.title).toEqual(A.eventType.title);
      expect(row?.length).toEqual(A.eventType.length);
      expect(row?.slug).toEqual(A.eventType.slug);
    };

    it("B cannot read A's event type by id", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v2/event-types/${A.eventType.id}`)
        .set("Authorization", bearer(B))
        .set(ev());
      expect(DENIED).toContain(res.status);
    });

    it("B list event types returns none of A's", async () => {
      const res = await request(app.getHttpServer())
        .get("/v2/event-types")
        .set("Authorization", bearer(B))
        .set(ev())
        .expect(200);
      const ids = (res.body.data as { id: number }[]).map((e) => e.id);
      expect(ids).not.toContain(A.eventType.id);
    });

    it("B cannot update A's event type", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v2/event-types/${A.eventType.id}`)
        .set("Authorization", bearer(B))
        .set(ev())
        .send({ title: "hijacked by B", lengthInMinutes: 99 });
      expect(DENIED).toContain(res.status);
      await eventTypeUnchanged();
    });

    it("B cannot delete A's event type", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/v2/event-types/${A.eventType.id}`)
        .set("Authorization", bearer(B))
        .set(ev());
      expect(DENIED).toContain(res.status);
      await eventTypeUnchanged();
    });
  });

  describe("schedules (2024-06-11)", () => {
    const sc = () => ({ [CAL_API_VERSION_HEADER]: VERSION_2024_06_11 });
    const scheduleUnchanged = async () => {
      const row = await schedulesFixture.getById(A.schedule.id);
      expect(row).not.toBeNull();
      expect(row?.name).toEqual(A.schedule.name);
      expect(row?.timeZone).toEqual(A.schedule.timeZone);
      expect(row?.userId).toEqual(A.user.id);
    };

    it("B cannot read A's schedule by id", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v2/schedules/${A.schedule.id}`)
        .set("Authorization", bearer(B))
        .set(sc());
      expect(DENIED).toContain(res.status);
    });

    it("B list schedules returns none of A's", async () => {
      const res = await request(app.getHttpServer())
        .get("/v2/schedules")
        .set("Authorization", bearer(B))
        .set(sc())
        .expect(200);
      const ids = (res.body.data as { id: number }[]).map((s) => s.id);
      expect(ids).not.toContain(A.schedule.id);
    });

    it("B cannot update A's schedule", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v2/schedules/${A.schedule.id}`)
        .set("Authorization", bearer(B))
        .set(sc())
        .send({ name: "hijacked by B", timeZone: "Asia/Tokyo" });
      expect(DENIED).toContain(res.status);
      await scheduleUnchanged();
    });

    it("B cannot delete A's schedule", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/v2/schedules/${A.schedule.id}`)
        .set("Authorization", bearer(B))
        .set(sc());
      expect(DENIED).toContain(res.status);
      await scheduleUnchanged();
    });
  });
});
