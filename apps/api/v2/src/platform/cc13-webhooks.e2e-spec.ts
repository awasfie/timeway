import type { PlatformOAuthClient, Team, User, Webhook } from "@calcom/prisma/client";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { EventTypesRepositoryFixture } from "test/fixtures/repository/event-types.repository.fixture";
import { OAuthClientRepositoryFixture } from "test/fixtures/repository/oauth-client.repository.fixture";
import { TeamRepositoryFixture } from "test/fixtures/repository/team.repository.fixture";
import { TokensRepositoryFixture } from "test/fixtures/repository/tokens.repository.fixture";
import { UserRepositoryFixture } from "test/fixtures/repository/users.repository.fixture";
import { WebhookRepositoryFixture } from "test/fixtures/repository/webhooks.repository.fixture";
import { randomString } from "test/utils/randomString";
import { mockThrottlerGuard } from "test/utils/withNoThrottler";
import { AppModule } from "@/app.module";
import { bootstrap } from "@/bootstrap";
import { PermissionsGuard } from "@/modules/auth/guards/permissions/permissions.guard";
import { PrismaModule } from "@/modules/prisma/prisma.module";
import { UsersModule } from "@/modules/users/users.module";

/**
 * CC-13 apiV2 webhook probes (WC-TW-7c-4): the v2 webhooks module (user, event-type and
 * oauth-client scopes). Tenant B's OAuth client access token against tenant A's webhook config.
 * Pass = B gets 401/403/404 AND A's row is unchanged.
 */
interface Tenant {
  label: "A" | "B";
  org: Team;
  client: PlatformOAuthClient;
  user: User;
  accessToken: string;
  eventTypeId: number;
  userWebhook: Webhook;
  eventTypeWebhook: Webhook;
  clientWebhook: Webhook;
}

const DENIED = [401, 403, 404];

describe("CC-13 apiV2 webhook probes: config isolation", () => {
  let app: INestApplication;
  let eventTypesFixture: EventTypesRepositoryFixture;
  let oauthFixture: OAuthClientRepositoryFixture;
  let teamFixture: TeamRepositoryFixture;
  let userFixture: UserRepositoryFixture;
  let tokensFixture: TokensRepositoryFixture;
  let webhookFixture: WebhookRepositoryFixture;
  let A: Tenant;
  let B: Tenant;
  const tag = `cc13-wh-${randomString()}`;

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
    const eventType = await eventTypesFixture.create(
      { title: `${t}-event-type`, slug: `${t}-event-type`, length: 30 },
      user.id
    );
    const base = { subscriberUrl: `https://example.com/${t}`, eventTriggers: ["BOOKING_CREATED" as const] };
    const userWebhook = await webhookFixture.create({
      id: `${t}-user-wh`,
      ...base,
      subscriberUrl: `${base.subscriberUrl}/user`,
      secret: `${t}-user-secret`,
      user: { connect: { id: user.id } },
    });
    const eventTypeWebhook = await webhookFixture.create({
      id: `${t}-et-wh`,
      ...base,
      subscriberUrl: `${base.subscriberUrl}/et`,
      secret: `${t}-et-secret`,
      eventType: { connect: { id: eventType.id } },
    });
    const clientWebhook = await webhookFixture.create({
      id: `${t}-client-wh`,
      ...base,
      subscriberUrl: `${base.subscriberUrl}/client`,
      secret: `${t}-client-secret`,
      platformOAuthClient: { connect: { id: client.id } },
    });
    return {
      label,
      org,
      client,
      user,
      accessToken,
      eventTypeId: eventType.id,
      userWebhook,
      eventTypeWebhook,
      clientWebhook,
    };
  }

  const bearer = (t: Tenant) => `Bearer ${t.accessToken}`;
  const row = (id: string) => webhookFixture.get(id);

  beforeAll(async () => {
    mockThrottlerGuard();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, PrismaModule, UsersModule],
    })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    eventTypesFixture = new EventTypesRepositoryFixture(moduleRef);
    oauthFixture = new OAuthClientRepositoryFixture(moduleRef);
    teamFixture = new TeamRepositoryFixture(moduleRef);
    userFixture = new UserRepositoryFixture(moduleRef);
    tokensFixture = new TokensRepositoryFixture(moduleRef);
    webhookFixture = new WebhookRepositoryFixture(moduleRef);

    A = await seedTenant("A");
    B = await seedTenant("B");

    app = moduleRef.createNestApplication();
    bootstrap(app as NestExpressApplication);
    await app.init();
  });

  afterAll(async () => {
    for (const t of [A, B]) {
      if (!t) continue;
      for (const w of [t.userWebhook, t.eventTypeWebhook, t.clientWebhook]) {
        await webhookFixture.delete(w.id).catch(() => undefined);
      }
      await eventTypesFixture.delete(t.eventTypeId).catch(() => undefined);
      await userFixture.deleteByEmail(t.user.email).catch(() => undefined);
      await oauthFixture.delete(t.client.id).catch(() => undefined);
      await teamFixture.delete(t.org.id).catch(() => undefined);
    }
    await app?.close();
  });

  describe("user webhooks (/v2/webhooks)", () => {
    it("B list webhooks returns none of A's", async () => {
      const res = await request(app.getHttpServer()).get("/v2/webhooks").set("Authorization", bearer(B));
      expect(DENIED.concat(200)).toContain(res.status);
      const ids = res.status === 200 ? (res.body.data as { id: string }[]).map((w) => w.id) : [];
      for (const w of [A.userWebhook, A.eventTypeWebhook, A.clientWebhook]) {
        expect(ids).not.toContain(w.id);
      }
    });

    it("B cannot read A's webhook", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v2/webhooks/${A.userWebhook.id}`)
        .set("Authorization", bearer(B));
      expect(DENIED).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toContain(A.userWebhook.secret as string);
    });

    it("B cannot update A's webhook", async () => {
      const before = await row(A.userWebhook.id);
      const res = await request(app.getHttpServer())
        .patch(`/v2/webhooks/${A.userWebhook.id}`)
        .set("Authorization", bearer(B))
        .send({ subscriberUrl: "https://example.com/hijacked", active: false });
      expect(DENIED).toContain(res.status);
      expect(await row(A.userWebhook.id)).toEqual(before);
    });

    it("B cannot delete A's webhook", async () => {
      const before = await row(A.userWebhook.id);
      const res = await request(app.getHttpServer())
        .delete(`/v2/webhooks/${A.userWebhook.id}`)
        .set("Authorization", bearer(B));
      expect(DENIED).toContain(res.status);
      expect(await row(A.userWebhook.id)).toEqual(before);
    });
  });

  describe("event-type webhooks (/v2/event-types/:id/webhooks)", () => {
    it("B cannot list, read, update or delete webhooks on A's event type", async () => {
      const before = await row(A.eventTypeWebhook.id);
      const base = `/v2/event-types/${A.eventTypeId}/webhooks`;
      const reqs = [
        request(app.getHttpServer()).get(base).set("Authorization", bearer(B)),
        request(app.getHttpServer()).get(`${base}/${A.eventTypeWebhook.id}`).set("Authorization", bearer(B)),
        request(app.getHttpServer())
          .patch(`${base}/${A.eventTypeWebhook.id}`)
          .set("Authorization", bearer(B))
          .send({ subscriberUrl: "https://example.com/hijacked", active: false }),
        request(app.getHttpServer())
          .delete(`${base}/${A.eventTypeWebhook.id}`)
          .set("Authorization", bearer(B)),
        request(app.getHttpServer()).delete(base).set("Authorization", bearer(B)),
      ];
      for (const r of reqs) {
        const res = await r;
        expect(DENIED).toContain(res.status);
        expect(JSON.stringify(res.body)).not.toContain(A.eventTypeWebhook.secret as string);
      }
      expect(await row(A.eventTypeWebhook.id)).toEqual(before);
    });

    it("B cannot create a webhook on A's event type", async () => {
      const res = await request(app.getHttpServer())
        .post(`/v2/event-types/${A.eventTypeId}/webhooks`)
        .set("Authorization", bearer(B))
        .send({
          subscriberUrl: "https://example.com/planted",
          triggers: ["BOOKING_CREATED"],
          active: true,
        });
      expect(DENIED).toContain(res.status);
      expect(await webhookFixture.countByEventTypeId(A.eventTypeId)).toBe(1);
    });

    it("B cannot reach A's event type webhook through B's own event type path", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/v2/event-types/${B.eventTypeId}/webhooks/${A.eventTypeWebhook.id}`)
        .set("Authorization", bearer(B));
      expect(DENIED.concat(400)).toContain(res.status);
      expect(await row(A.eventTypeWebhook.id)).not.toBeNull();
    });
  });

  describe("oauth-client webhooks (/v2/oauth-clients/:clientId/webhooks)", () => {
    it("B cannot list, read, update or delete webhooks of A's oauth client", async () => {
      const before = await row(A.clientWebhook.id);
      const base = `/v2/oauth-clients/${A.client.id}/webhooks`;
      const reqs = [
        request(app.getHttpServer()).get(base).set("Authorization", bearer(B)),
        request(app.getHttpServer()).get(`${base}/${A.clientWebhook.id}`).set("Authorization", bearer(B)),
        request(app.getHttpServer())
          .patch(`${base}/${A.clientWebhook.id}`)
          .set("Authorization", bearer(B))
          .send({ subscriberUrl: "https://example.com/hijacked", active: false }),
        request(app.getHttpServer()).delete(`${base}/${A.clientWebhook.id}`).set("Authorization", bearer(B)),
        request(app.getHttpServer()).delete(base).set("Authorization", bearer(B)),
      ];
      for (const r of reqs) {
        const res = await r;
        expect(DENIED).toContain(res.status);
        expect(JSON.stringify(res.body)).not.toContain(A.clientWebhook.secret as string);
      }
      expect(await row(A.clientWebhook.id)).toEqual(before);
    });

    it("B cannot create a webhook on A's oauth client", async () => {
      const res = await request(app.getHttpServer())
        .post(`/v2/oauth-clients/${A.client.id}/webhooks`)
        .set("Authorization", bearer(B))
        .send({ subscriberUrl: "https://example.com/planted", triggers: ["BOOKING_CREATED"], active: true });
      expect(DENIED).toContain(res.status);
      expect(await webhookFixture.countByClientId(A.client.id)).toBe(1);
    });
  });
});
