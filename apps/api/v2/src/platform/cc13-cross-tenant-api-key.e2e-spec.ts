import {
  CAL_API_VERSION_HEADER,
  VERSION_2024_06_11,
  VERSION_2024_06_14,
  VERSION_2024_08_13,
} from "@calcom/platform-constants";
import type { ApiKey, Booking, EventType, Schedule, User } from "@calcom/prisma/client";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { ApiKeysRepositoryFixture } from "test/fixtures/repository/api-keys.repository.fixture";
import { BookingsRepositoryFixture } from "test/fixtures/repository/bookings.repository.fixture";
import { EventTypesRepositoryFixture } from "test/fixtures/repository/event-types.repository.fixture";
import { SchedulesRepositoryFixture } from "test/fixtures/repository/schedules.repository.fixture";
import { UserRepositoryFixture } from "test/fixtures/repository/users.repository.fixture";
import { randomString } from "test/utils/randomString";
import { mockThrottlerGuard } from "test/utils/withNoThrottler";
import { AppModule } from "@/app.module";
import { bootstrap } from "@/bootstrap";
import { PermissionsGuard } from "@/modules/auth/guards/permissions/permissions.guard";
import { PrismaModule } from "@/modules/prisma/prisma.module";
import { UsersModule } from "@/modules/users/users.module";

/**
 * CC-13 apiKey probes (WC-TW-7c-3): tenant B's upstream API key (Authorization: Bearer cal_...)
 * and tenant B's tw_org_api_key value (twk_...) against tenant A's resources through the v2 API-key
 * auth path. Pass = B gets 401/403/404 (or an A-free list) AND A's row/key is unchanged.
 */
interface Tenant {
  label: "A" | "B";
  user: User;
  key: ApiKey;
  keyString: string;
  eventType: EventType;
  schedule: Schedule;
  booking: Booking;
  pendingBooking: Booking;
}

const DENIED = [401, 403, 404];
const DENIED_OR_BAD_REQUEST = [400, ...DENIED];

describe("CC-13 apiKey cross-tenant probes (API v2, API-key auth)", () => {
  let app: INestApplication;
  let apiKeysFixture: ApiKeysRepositoryFixture;
  let bookingsFixture: BookingsRepositoryFixture;
  let eventTypesFixture: EventTypesRepositoryFixture;
  let schedulesFixture: SchedulesRepositoryFixture;
  let userFixture: UserRepositoryFixture;
  let A: Tenant;
  let B: Tenant;
  const tag = `cc13-key-${randomString()}`;
  const keyPrefix = process.env.API_KEY_PREFIX ?? "cal_";

  async function seedTenant(label: "A" | "B"): Promise<Tenant> {
    const t = `${tag}-${label.toLowerCase()}`;
    const user = await userFixture.create({ email: `${t}@api.com`, username: t, name: t });
    const { apiKey, keyString } = await apiKeysFixture.createApiKey(user.id, null);
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
        startTime: new Date(Date.UTC(2020, 0, 9, hour, 0, 0)),
        endTime: new Date(Date.UTC(2020, 0, 9, hour, 30, 0)),
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
    return { label, user, key: apiKey, keyString, eventType, schedule, booking, pendingBooking };
  }

  const bearer = (t: Tenant) => `Bearer ${keyPrefix}${t.keyString}`;
  // The tw_org_api_key raw format is twk_<prefix>.<secret>; any twk_ value is a non-cal_ bearer here.
  const orgKeyBearer = () => `Bearer twk_${tag}.${"0".repeat(48)}`;

  beforeAll(async () => {
    mockThrottlerGuard();
    const moduleRef = await Test.createTestingModule({ imports: [AppModule, PrismaModule, UsersModule] })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    apiKeysFixture = new ApiKeysRepositoryFixture(moduleRef);
    bookingsFixture = new BookingsRepositoryFixture(moduleRef);
    eventTypesFixture = new EventTypesRepositoryFixture(moduleRef);
    schedulesFixture = new SchedulesRepositoryFixture(moduleRef);
    userFixture = new UserRepositoryFixture(moduleRef);

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
      await eventTypesFixture.delete(t.eventType.id).catch(() => undefined);
      await schedulesFixture.deleteById(t.schedule.id).catch(() => undefined);
      await userFixture.deleteByEmail(t.user.email).catch(() => undefined);
    }
    await app?.close();
  });

  const keyStillValid = async (t: Tenant) => {
    const rows = await apiKeysFixture.getUserApiKeys(t.user.id);
    expect(rows.map((r) => r.id)).toContain(t.key.id);
    expect(rows.find((r) => r.id === t.key.id)?.hashedKey).toEqual(t.key.hashedKey);
  };

  it("B's API key lists none of A's bookings, event types or schedules", async () => {
    const bk = await request(app.getHttpServer())
      .get("/v2/bookings")
      .set("Authorization", bearer(B))
      .set(CAL_API_VERSION_HEADER, VERSION_2024_08_13)
      .expect(200);
    const uids = (bk.body.data as { uid: string }[]).map((b) => b.uid);
    expect(uids).toContain(B.booking.uid);
    expect(uids).not.toContain(A.booking.uid);
    expect(uids).not.toContain(A.pendingBooking.uid);

    const ev = await request(app.getHttpServer())
      .get("/v2/event-types")
      .set("Authorization", bearer(B))
      .set(CAL_API_VERSION_HEADER, VERSION_2024_06_14)
      .expect(200);
    expect((ev.body.data as { id: number }[]).map((e) => e.id)).not.toContain(A.eventType.id);

    const sc = await request(app.getHttpServer())
      .get("/v2/schedules")
      .set("Authorization", bearer(B))
      .set(CAL_API_VERSION_HEADER, VERSION_2024_06_11)
      .expect(200);
    expect((sc.body.data as { id: number }[]).map((s) => s.id)).not.toContain(A.schedule.id);
  });

  it("B's API key cannot read A's event type or schedule by id", async () => {
    const ev = await request(app.getHttpServer())
      .get(`/v2/event-types/${A.eventType.id}`)
      .set("Authorization", bearer(B))
      .set(CAL_API_VERSION_HEADER, VERSION_2024_06_14);
    expect(DENIED).toContain(ev.status);
    const sc = await request(app.getHttpServer())
      .get(`/v2/schedules/${A.schedule.id}`)
      .set("Authorization", bearer(B))
      .set(CAL_API_VERSION_HEADER, VERSION_2024_06_11);
    expect(DENIED).toContain(sc.status);
  });

  it("B's API key cannot update or delete A's event type and schedule", async () => {
    const ver = (v: string) => ({ [CAL_API_VERSION_HEADER]: v });
    const calls = [
      request(app.getHttpServer())
        .patch(`/v2/event-types/${A.eventType.id}`)
        .set("Authorization", bearer(B))
        .set(ver(VERSION_2024_06_14))
        .send({ title: "hijacked by B key", lengthInMinutes: 99 }),
      request(app.getHttpServer())
        .delete(`/v2/event-types/${A.eventType.id}`)
        .set("Authorization", bearer(B))
        .set(ver(VERSION_2024_06_14)),
      request(app.getHttpServer())
        .patch(`/v2/schedules/${A.schedule.id}`)
        .set("Authorization", bearer(B))
        .set(ver(VERSION_2024_06_11))
        .send({ name: "hijacked by B key", timeZone: "Asia/Tokyo" }),
      request(app.getHttpServer())
        .delete(`/v2/schedules/${A.schedule.id}`)
        .set("Authorization", bearer(B))
        .set(ver(VERSION_2024_06_11)),
    ];
    for (const res of await Promise.all(calls)) expect(DENIED).toContain(res.status);

    const et = await eventTypesFixture.findById(A.eventType.id);
    expect(et?.title).toEqual(A.eventType.title);
    expect(et?.length).toEqual(A.eventType.length);
    const sc = await schedulesFixture.getById(A.schedule.id);
    expect(sc?.name).toEqual(A.schedule.name);
    expect(sc?.timeZone).toEqual(A.schedule.timeZone);
  });

  it("B's API key cannot confirm or decline A's pending booking", async () => {
    for (const [path, body] of [
      ["confirm", {}],
      ["decline", { reason: "cc13 key probe" }],
    ] as const) {
      const res = await request(app.getHttpServer())
        .post(`/v2/bookings/${A.pendingBooking.uid}/${path}`)
        .set("Authorization", bearer(B))
        .set(CAL_API_VERSION_HEADER, VERSION_2024_08_13)
        .send(body);
      expect(DENIED).toContain(res.status);
    }
    const row = await bookingsFixture.getByUid(A.pendingBooking.uid);
    expect(row?.status).toEqual("PENDING");
    expect(row?.rejectionReason ?? null).toBeNull();
  });

  it("B's API key cannot read A's booking references", async () => {
    const res = await request(app.getHttpServer())
      .get(`/v2/bookings/${A.booking.uid}/references`)
      .set("Authorization", bearer(B))
      .set(CAL_API_VERSION_HEADER, VERSION_2024_08_13);
    expect(DENIED_OR_BAD_REQUEST).toContain(res.status);
  });

  it("B's API key refresh never rotates or deletes A's key", async () => {
    // Key creation is disabled in this edition, so refresh may answer 500; either way it is B's own key at stake.
    await request(app.getHttpServer())
      .post("/v2/api-keys/refresh")
      .set("Authorization", bearer(B))
      .send({ apiKeyDaysValid: 30 });
    await keyStillValid(A);
    const aRes = await request(app.getHttpServer())
      .get("/v2/schedules")
      .set("Authorization", bearer(A))
      .set(CAL_API_VERSION_HEADER, VERSION_2024_06_11);
    expect(aRes.status).toEqual(200);
  });

  it("B's tw_org_api_key value is not accepted as a v2 credential and exposes nothing of A", async () => {
    for (const path of ["/v2/bookings", "/v2/event-types", "/v2/schedules"]) {
      const res = await request(app.getHttpServer())
        .get(path)
        .set("Authorization", orgKeyBearer())
        .set(CAL_API_VERSION_HEADER, path === "/v2/bookings" ? VERSION_2024_08_13 : VERSION_2024_06_14);
      expect(DENIED).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toContain(A.user.email);
    }
    const refresh = await request(app.getHttpServer())
      .post("/v2/api-keys/refresh")
      .set("Authorization", orgKeyBearer())
      .send({});
    expect(DENIED).toContain(refresh.status);
    await keyStillValid(A);
  });
});
