import { X_CAL_SECRET_KEY } from "@calcom/platform-constants";
import { MembershipRole } from "@calcom/platform-libraries";
import type { Credential, Membership, PlatformOAuthClient, Team, User } from "@calcom/prisma/client";
import type { INestApplication } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { CredentialsRepositoryFixture } from "test/fixtures/repository/credentials.repository.fixture";
import { MembershipRepositoryFixture } from "test/fixtures/repository/membership.repository.fixture";
import { OAuthClientRepositoryFixture } from "test/fixtures/repository/oauth-client.repository.fixture";
import { TeamRepositoryFixture } from "test/fixtures/repository/team.repository.fixture";
import { TokensRepositoryFixture } from "test/fixtures/repository/tokens.repository.fixture";
import { UserRepositoryFixture } from "test/fixtures/repository/users.repository.fixture";
import { VerifiedResourcesRepositoryFixture } from "test/fixtures/repository/verified-resources.repository.fixture";
import { randomString } from "test/utils/randomString";
import { mockThrottlerGuard } from "test/utils/withNoThrottler";
import { AppModule } from "@/app.module";
import { bootstrap } from "@/bootstrap";
import { PermissionsGuard } from "@/modules/auth/guards/permissions/permissions.guard";
import { PrismaModule } from "@/modules/prisma/prisma.module";
import { UsersModule } from "@/modules/users/users.module";

/**
 * CC-13 apiV2 probes, part 2 (WC-TW-7c-2): organizations, teams, memberships, credentials.
 * Tenant B's OAuth client access token (B is org OWNER of its own org) is used against tenant A's
 * OAuth client, managed user, membership, credentials and verified resources.
 * Pass = B gets 401/403/404 (or an empty/A-free list) AND A's row is unchanged.
 */
interface Tenant {
  org: Team;
  client: PlatformOAuthClient;
  user: User;
  membership: Membership;
  accessToken: string;
  refreshToken: string;
  zoomCredential: Credential;
  calendarCredential: Credential;
  verifiedEmailId: number;
  verifiedPhoneId: number;
}

const DENIED = [401, 403, 404];
// 400 "not connected / invalid" is a refusal that returns no data and changes nothing.
const DENIED_OR_BAD_REQUEST = [400, ...DENIED];

describe("CC-13 apiV2 cross-tenant probes: organizations, teams, memberships, credentials", () => {
  let app: INestApplication;
  let oauthFixture: OAuthClientRepositoryFixture;
  let teamFixture: TeamRepositoryFixture;
  let userFixture: UserRepositoryFixture;
  let tokensFixture: TokensRepositoryFixture;
  let membershipFixture: MembershipRepositoryFixture;
  let credentialsFixture: CredentialsRepositoryFixture;
  let verifiedFixture: VerifiedResourcesRepositoryFixture;
  let A: Tenant;
  let B: Tenant;
  const tag = `cc13-org-${randomString()}`;

  async function seedTenant(label: "a" | "b"): Promise<Tenant> {
    const t = `${tag}-${label}`;
    const org = await teamFixture.create({
      name: `${t}-org`,
      isOrganization: true,
      isPlatform: true,
      metadata: { isOrganization: true, isOrganizationVerified: true, isOrganizationConfigured: true },
    });
    const client = await oauthFixture.create(
      org.id,
      { logo: "logo-url", name: `${t}-client`, redirectUris: ["http://localhost:5555"], permissions: 1023 },
      `${t}-secret`
    );
    const user = await userFixture.create({
      email: `${t}@api.com`,
      username: t,
      name: t,
      platformOAuthClients: { connect: { id: client.id } },
    });
    const membership = await membershipFixture.addUserToOrg(user, org, MembershipRole.OWNER, true);
    const { accessToken, refreshToken } = await tokensFixture.createTokens(user.id, client.id);
    const zoomCredential = await credentialsFixture.create("zoom_video", { access_token: `${t}-z` }, user.id, "zoom");
    const calendarCredential = await credentialsFixture.create(
      "google_calendar",
      { access_token: `${t}-g` },
      user.id,
      "google-calendar"
    );
    const verifiedEmail = await verifiedFixture.createEmail({
      email: `${t}-verified@example.com`,
      user: { connect: { id: user.id } },
    });
    const verifiedPhone = await verifiedFixture.createPhone({
      phoneNumber: `+1555${Math.floor(1000000 + Math.random() * 8999999)}`,
      user: { connect: { id: user.id } },
    });
    return {
      org,
      client,
      user,
      membership,
      accessToken,
      refreshToken,
      zoomCredential,
      calendarCredential,
      verifiedEmailId: verifiedEmail.id,
      verifiedPhoneId: verifiedPhone.id,
    };
  }

  const bearer = (t: Tenant) => `Bearer ${t.accessToken}`;

  beforeAll(async () => {
    mockThrottlerGuard();
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, PrismaModule, UsersModule],
    })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    oauthFixture = new OAuthClientRepositoryFixture(moduleRef);
    teamFixture = new TeamRepositoryFixture(moduleRef);
    userFixture = new UserRepositoryFixture(moduleRef);
    tokensFixture = new TokensRepositoryFixture(moduleRef);
    membershipFixture = new MembershipRepositoryFixture(moduleRef);
    credentialsFixture = new CredentialsRepositoryFixture(moduleRef);
    verifiedFixture = new VerifiedResourcesRepositoryFixture(moduleRef);

    A = await seedTenant("a");
    B = await seedTenant("b");

    app = moduleRef.createNestApplication();
    bootstrap(app as NestExpressApplication);
    await app.init();
  });

  afterAll(async () => {
    for (const t of [A, B]) {
      if (!t) continue;
      await credentialsFixture.delete(t.zoomCredential.id).catch(() => undefined);
      await credentialsFixture.delete(t.calendarCredential.id).catch(() => undefined);
      await verifiedFixture.deleteEmailById(t.verifiedEmailId).catch(() => undefined);
      await verifiedFixture.deletePhoneById(t.verifiedPhoneId).catch(() => undefined);
      await userFixture.deleteByEmail(t.user.email).catch(() => undefined);
      await oauthFixture.delete(t.client.id).catch(() => undefined);
      await teamFixture.delete(t.org.id).catch(() => undefined);
    }
    await app?.close();
  });

  describe("oauth clients (organization scope)", () => {
    const clientUnchanged = async () => {
      const row = await oauthFixture.get(A.client.id);
      expect(row).not.toBeNull();
      expect(row?.name).toEqual(A.client.name);
      expect(row?.organizationId).toEqual(A.org.id);
      expect(row?.secret).toEqual(A.client.secret);
    };

    it("B cannot read A's OAuth client", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v2/oauth-clients/${A.client.id}`)
        .set("Authorization", bearer(B));
      expect(DENIED).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toContain(A.client.secret);
    });

    it("B list OAuth clients returns none of A's", async () => {
      const res = await request(app.getHttpServer()).get("/v2/oauth-clients").set("Authorization", bearer(B));
      if (res.status === 200) {
        const ids = (res.body.data as { id: string }[]).map((c) => c.id);
        expect(ids).not.toContain(A.client.id);
        expect(JSON.stringify(res.body)).not.toContain(A.client.secret);
      } else {
        expect(DENIED).toContain(res.status);
      }
    });

    it("B cannot update A's OAuth client", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v2/oauth-clients/${A.client.id}`)
        .set("Authorization", bearer(B))
        .send({ name: "hijacked by B" });
      expect(DENIED).toContain(res.status);
      await clientUnchanged();
    });

    it("B cannot delete A's OAuth client", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/v2/oauth-clients/${A.client.id}`)
        .set("Authorization", bearer(B));
      expect(DENIED).toContain(res.status);
      await clientUnchanged();
    });

    it("B cannot list A's managed users via the deprecated client route", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v2/oauth-clients/${A.client.id}/managed-users`)
        .set("Authorization", bearer(B));
      expect(DENIED).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toContain(A.user.email);
    });
  });

  describe("managed users, profiles and memberships", () => {
    const userUnchanged = async () => {
      const row = await userFixture.get(A.user.id);
      expect(row).not.toBeNull();
      expect(row?.name).toEqual(A.user.name);
      expect(row?.email).toEqual(A.user.email);
      expect(row?.organizationId).toEqual(A.org.id);
      const membership = await membershipFixture.get(A.membership.id);
      expect(membership).not.toBeNull();
      expect(membership?.role).toEqual(MembershipRole.OWNER);
      expect(membership?.teamId).toEqual(A.org.id);
    };

    it("B cannot list A's managed users", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v2/oauth-clients/${A.client.id}/users`)
        .set("Authorization", bearer(B));
      expect(DENIED).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toContain(A.user.email);
    });

    it("B cannot read A's managed user", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v2/oauth-clients/${A.client.id}/users/${A.user.id}`)
        .set("Authorization", bearer(B));
      expect(DENIED).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toContain(A.user.email);
    });

    it("B cannot create a managed user under A's OAuth client", async () => {
      const email = `${tag}-planted@api.com`;
      const res = await request(app.getHttpServer())
        .post(`/v2/oauth-clients/${A.client.id}/users`)
        .set("Authorization", bearer(B))
        .send({ email, name: "planted by B", timeZone: "Europe/Rome" });
      expect(DENIED_OR_BAD_REQUEST).toContain(res.status);
      const clientUsers = await oauthFixture.getUsers(A.client.id);
      expect((clientUsers ?? []).map((u) => u.email)).not.toContain(email);
      await userFixture.deleteByEmail(email).catch(() => undefined);
    });

    it("B cannot update A's managed user or membership", async () => {
      const res = await request(app.getHttpServer())
        .patch(`/v2/oauth-clients/${A.client.id}/users/${A.user.id}`)
        .set("Authorization", bearer(B))
        .send({ name: "hijacked by B" });
      expect(DENIED).toContain(res.status);
      await userUnchanged();
    });

    it("B cannot delete A's managed user", async () => {
      const res = await request(app.getHttpServer())
        .delete(`/v2/oauth-clients/${A.client.id}/users/${A.user.id}`)
        .set("Authorization", bearer(B));
      expect(DENIED).toContain(res.status);
      await userUnchanged();
    });

    it("B cannot force-refresh A's managed user tokens", async () => {
      const res = await request(app.getHttpServer())
        .post(`/v2/oauth-clients/${A.client.id}/users/${A.user.id}/force-refresh`)
        .set("Authorization", bearer(B));
      expect(DENIED).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toContain(A.accessToken);
      await userUnchanged();
    });

    it("B reads only its own profile via /me", async () => {
      const res = await request(app.getHttpServer()).get("/v2/me").set("Authorization", bearer(B)).expect(200);
      expect(res.body.data.id).toEqual(B.user.id);
      expect(res.body.data.email).not.toEqual(A.user.email);
      expect(res.body.data.organizationId).toEqual(B.org.id);
      expect(res.body.data.organizationId).not.toEqual(A.org.id);
    });

    it("B updating /me with A's ids in the body leaves A's user unchanged", async () => {
      const res = await request(app.getHttpServer())
        .patch("/v2/me")
        .set("Authorization", bearer(B))
        .send({ name: `${tag}-b-renamed`, id: A.user.id, email: A.user.email });
      expect([200, 400, ...DENIED]).toContain(res.status);
      await userUnchanged();
    });
  });

  describe("oauth tokens", () => {
    it("B cannot refresh A's tokens with B's client secret", async () => {
      const res = await request(app.getHttpServer())
        .post(`/v2/oauth/${A.client.id}/refresh`)
        .set("Authorization", bearer(B))
        .set(X_CAL_SECRET_KEY, B.client.secret)
        .send({ refreshToken: A.refreshToken });
      expect(DENIED_OR_BAD_REQUEST).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toContain(A.accessToken);
    });

    it("B cannot refresh A's tokens through B's own client id", async () => {
      const res = await request(app.getHttpServer())
        .post(`/v2/oauth/${B.client.id}/refresh`)
        .set("Authorization", bearer(B))
        .set(X_CAL_SECRET_KEY, B.client.secret)
        .send({ refreshToken: A.refreshToken });
      expect(DENIED_OR_BAD_REQUEST).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toContain(A.accessToken);
    });

    it("A's access token still resolves to A after B's attempts", async () => {
      const res = await request(app.getHttpServer()).get("/v2/me").set("Authorization", bearer(A)).expect(200);
      expect(res.body.data.id).toEqual(A.user.id);
    });
  });

  describe("credentials", () => {
    const credentialExists = async (id: number) => {
      const row = await credentialsFixture.get(id);
      expect(row).not.toBeNull();
    };

    it("B cannot disconnect A's calendar credential", async () => {
      const res = await request(app.getHttpServer())
        .post("/v2/calendars/google/disconnect")
        .set("Authorization", bearer(B))
        .send({ id: A.calendarCredential.id });
      expect(DENIED_OR_BAD_REQUEST).toContain(res.status);
      await credentialExists(A.calendarCredential.id);
    });

    it("B cannot disconnect A's conferencing credential", async () => {
      const res = await request(app.getHttpServer())
        .delete("/v2/conferencing/zoom/disconnect")
        .set("Authorization", bearer(B));
      expect(DENIED_OR_BAD_REQUEST).toContain(res.status);
      await credentialExists(A.zoomCredential.id);
    });

    it("B conferencing list does not include A's credential", async () => {
      const res = await request(app.getHttpServer()).get("/v2/conferencing").set("Authorization", bearer(B));
      expect(res.status).toBe(200);
      const ids = (res.body.data as { id?: number; credentialId?: number }[]).flatMap((c) => [c.id, c.credentialId]);
      expect(ids).not.toContain(A.zoomCredential.id);
    });

    it("B cannot read A's verified email by id", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v2/verified-resources/emails/${A.verifiedEmailId}`)
        .set("Authorization", bearer(B));
      expect(DENIED_OR_BAD_REQUEST).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toContain(`${tag}-a-verified@example.com`);
    });

    it("B cannot read A's verified phone by id", async () => {
      const res = await request(app.getHttpServer())
        .get(`/v2/verified-resources/phones/${A.verifiedPhoneId}`)
        .set("Authorization", bearer(B));
      expect(DENIED_OR_BAD_REQUEST).toContain(res.status);
    });

    it("B verified-resources lists contain none of A's", async () => {
      const emails = await request(app.getHttpServer())
        .get("/v2/verified-resources/emails")
        .set("Authorization", bearer(B))
        .expect(200);
      expect(JSON.stringify(emails.body)).not.toContain(`${tag}-a-verified@example.com`);
      const phones = await request(app.getHttpServer())
        .get("/v2/verified-resources/phones")
        .set("Authorization", bearer(B))
        .expect(200);
      expect((phones.body.data as { id: number }[]).map((p) => p.id)).not.toContain(A.verifiedPhoneId);
    });
  });
});
