/**
 * CC-13 gap probes, WC-TW-7b-5 part 2 (t_f1729c9d): the five pages/publicSlug cells that had no probe.
 * Each probe seeds tenant A rows and attempts access as tenant B (signed in) or anonymous, in-process
 * against the real DB. A probe passes when nothing of A's beyond the intended public surface comes back.
 *
 *   Credential/pages            /apps/installation getServerSideProps (session-gated, teamId param)
 *   Organization/publicSlug     /team/<orgSlug> landing (loadOrgLanding via OrgLandingRepository)
 *   OrganizationMember/publicSlug  same landing: member list is public fields only
 *   TwCustomHostname/publicSlug custom-host resolver (CustomHostResolverRepository)
 *   Avatar/publicSlug           /api/avatar/[uuid]: public by uuid; knowing the uuid IS the capability
 */
import { randomBytes, randomUUID } from "node:crypto";
import { CustomHostResolverRepository } from "@calcom/features/customHostnames/repositories/CustomHostResolverRepository";
import { resolveCustomHost } from "@calcom/lib/domainManager/customHostnames/resolve";
import { withTwPlatform } from "@calcom/prisma/tw-org-context";
import type { GetServerSidePropsContext } from "next";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Cc13Seed, SeededTenant } from "./seed";
import { seedCc13Tenants } from "./seed";
import { prisma } from "./trpc-harness";

const session = vi.hoisted(() => ({ current: null as null | { user: { id: number } } }));
vi.mock("@calcom/features/auth/lib/getServerSession", () => ({
  getServerSession: vi.fn(async () => session.current),
}));
vi.mock("app/_utils", () => ({
  _generateMetadata: async () => ({}),
  getTranslate: async () => (k: string) => k,
}));
// React's per-request cache() is absent in the vitest react build; a passthrough keeps every call uncached.
vi.mock("react", async (orig) => ({ ...(await orig<typeof import("react")>()), cache: <T>(fn: T) => fn }));
vi.mock("~/team/org-landing-view", () => ({ default: () => null }));
vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: never[]) => unknown>(fn: T) => fn,
  revalidatePath: () => undefined,
  revalidateTag: () => undefined,
}));

import { getServerSideProps as installationSSR } from "../../lib/apps/installation/[[...step]]/getServerSideProps";
import { OrgLandingPage } from "../../lib/team/[slug]/orgLandingPage";

let seed: Cc13Seed;
const tag = (t: SeededTenant) => `cc13-${seed.runId}-${t.label.toLowerCase()}`;
const APP = "zohocalendar";
const TINY_PNG = (marker: string) =>
  `data:image/png;base64,${Buffer.from(`PNG-${marker}`).toString("base64")}`;

type Fx = {
  appCreated: boolean;
  credA: { user: number; team: number };
  credB: { user: number };
  aPublicUser: { id: number; username: string; email: string };
  aLockedUser: { id: number; username: string };
  aHiddenUser: { id: number; username: string };
  aSharedName: { id: number; username: string };
  bSharedName: { id: number };
  aHiddenEvent: string;
  hostA: string;
  hostAPending: string;
  hostAFailed: string;
  hostB: string;
  avatarA: { key: string; marker: string };
  avatarB: { key: string; marker: string };
};
let fx: Fx;

beforeAll(async () => {
  seed = await seedCc13Tenants();
  const { A, B } = seed;

  const existing = await prisma.app.findUnique({ where: { slug: APP } });
  if (!existing) {
    await prisma.app.create({
      data: { slug: APP, dirName: APP, categories: ["calendar"], enabled: true },
    });
  } else if (!existing.enabled) {
    await prisma.app.update({ where: { slug: APP }, data: { enabled: true } });
  }
  const credA = {
    user: (
      await prisma.credential.create({
        data: { type: "zoho_calendar", key: { tag: tag(A) }, appId: APP, userId: A.owner.id },
        select: { id: true },
      })
    ).id,
    team: (
      await prisma.credential.create({
        data: { type: "zoho_calendar", key: { tag: tag(A) }, appId: APP, teamId: A.team.id },
        select: { id: true },
      })
    ).id,
  };
  const credB = {
    user: (
      await prisma.credential.create({
        data: { type: "zoho_calendar", key: { tag: tag(B) }, appId: APP, userId: B.owner.id },
        select: { id: true },
      })
    ).id,
  };

  // Org landing fixtures on A: a listed member, a locked one, one with only a hidden event, and one
  // whose username also exists in B (must be left out).
  const mkUser = (suffix: string, org: SeededTenant, extra: Record<string, unknown> = {}) =>
    prisma.user.create({
      data: {
        email: `${tag(org)}-${suffix}@cc13.test`,
        username: `${tag(org)}-${suffix}`,
        name: `CC-13 ${org.label} ${suffix}`,
        twOrgId: org.twOrg.id,
        ...extra,
      },
      select: { id: true, username: true, email: true },
    });
  const aPublicUser = await mkUser("pub", A);
  const aLockedUser = await mkUser("locked", A, { locked: true });
  const aHiddenUser = await mkUser("hid", A);
  const shared = `${tag(A)}-shared`;
  const aSharedName = await prisma.user.create({
    data: { email: `${tag(A)}-shared@cc13.test`, username: shared, name: "A shared", twOrgId: A.twOrg.id },
    select: { id: true, username: true },
  });
  const bSharedName = await prisma.user.create({
    data: {
      email: `${tag(B)}-shared@cc13.test`,
      username: shared,
      name: "B shared",
      twOrgId: B.twOrg.id,
      organizationId: B.team.id,
    },
    select: { id: true },
  });
  const mkEvent = (userId: number, slug: string, hidden: boolean, org: SeededTenant) =>
    prisma.eventType.create({
      data: {
        title: `${tag(org)} ${slug}`,
        slug: `${tag(org)}-${slug}`,
        length: 15,
        hidden,
        owner: { connect: { id: userId } },
        users: { connect: { id: userId } },
        twOrgId: org.twOrg.id,
      },
      select: { slug: true },
    });
  await mkEvent(aPublicUser.id, "pub-ev", false, A);
  await mkEvent(aLockedUser.id, "locked-ev", false, A);
  const hid = await mkEvent(aHiddenUser.id, "hid-ev", true, A);
  await mkEvent(aSharedName.id, "shared-ev", false, A);

  // Custom hostnames (tw_* tables are FORCE RLS: platform context).
  const hostA = `a-${seed.runId}.cc13.example.com`;
  const hostB = `b-${seed.runId}.cc13.example.com`;
  const hostAPending = `ap-${seed.runId}.cc13.example.com`;
  const hostAFailed = `af-${seed.runId}.cc13.example.com`;
  await withTwPlatform(prisma, `CC-13 seed hostnames ${tag(A)}`, async (tx) => {
    await tx.twCustomHostname.create({
      data: { orgId: A.twOrg.id, hostname: hostA, status: "active" },
    });
    await tx.twCustomHostname.create({
      data: { orgId: B.twOrg.id, hostname: hostB, status: "active" },
    });
  });

  const avatarA = { key: randomUUID(), marker: `A-${randomBytes(4).toString("hex")}` };
  const avatarB = { key: randomUUID(), marker: `B-${randomBytes(4).toString("hex")}` };
  await prisma.avatar.create({
    data: { teamId: A.team.id, userId: A.owner.id, objectKey: avatarA.key, data: TINY_PNG(avatarA.marker) },
  });
  await prisma.avatar.create({
    data: { teamId: B.team.id, userId: B.owner.id, objectKey: avatarB.key, data: TINY_PNG(avatarB.marker) },
  });

  fx = {
    appCreated: !existing,
    credA,
    credB,
    aPublicUser,
    aLockedUser: { id: aLockedUser.id, username: aLockedUser.username ?? "" },
    aHiddenUser: { id: aHiddenUser.id, username: aHiddenUser.username ?? "" },
    aSharedName,
    bSharedName,
    aHiddenEvent: hid.slug,
    hostA,
    hostAPending,
    hostAFailed,
    hostB,
    avatarA,
    avatarB,
  } as Fx;
}, 60_000);

afterAll(async () => {
  session.current = null;
  if (fx) {
    const ids = [fx.credA.user, fx.credA.team, fx.credB.user];
    await prisma.credential.deleteMany({ where: { id: { in: ids } } });
    if (fx.appCreated) await prisma.app.deleteMany({ where: { slug: APP } });
    await prisma.avatar.deleteMany({ where: { objectKey: { in: [fx.avatarA.key, fx.avatarB.key] } } });
    await prisma.user.deleteMany({ where: { id: { in: [fx.bSharedName.id] } } });
    await withTwPlatform(prisma, "CC-13 cleanup hostnames", (tx) =>
      tx.twCustomHostname.deleteMany({
        where: { orgId: { in: [seed.A.twOrg.id, seed.B.twOrg.id] } },
      })
    );
  }
  await seed?.cleanup();
});

const ctx = (query: Record<string, string>, step?: string): GetServerSidePropsContext =>
  ({
    req: { headers: { host: "timeway.co" }, cookies: {} },
    res: {},
    params: step ? { step: [step] } : {},
    query,
    resolvedUrl: "/",
  }) as unknown as GetServerSidePropsContext;

describe("CC-13 gap probes: pages and publicSlug (WC-TW-7b-5 part 2)", () => {
  describe("Credential / pages: /apps/installation", () => {
    it("installation page: B with ?teamId=A's team is redirected to /apps and gets none of A's credentials", async () => {
      session.current = { user: { id: seed.B.owner.id } };
      const before = await prisma.credential.findMany({
        where: { id: { in: [fx.credA.user, fx.credA.team] } },
      });
      const res = await installationSSR(ctx({ slug: APP, teamId: String(seed.A.team.id) }, "accounts"));
      expect(res).toEqual({ redirect: { permanent: false, destination: "/apps" } });
      expect(JSON.stringify(res)).not.toContain(String(fx.credA.team));
      const after = await prisma.credential.findMany({
        where: { id: { in: [fx.credA.user, fx.credA.team] } },
      });
      expect(after).toEqual(before);
    });

    it("installation page: B without teamId gets props holding none of A's credential ids or team", async () => {
      session.current = { user: { id: seed.B.owner.id } };
      const res = await installationSSR(ctx({ slug: APP }, "accounts"));
      expect("props" in res, `expected props, got ${JSON.stringify(res).slice(0, 200)}`).toBe(true);
      const props = (res as { props: Record<string, unknown> }).props;
      expect(props.credentialId).toBe(fx.credB.user);
      const blob = JSON.stringify(props);
      expect(props.credentialId).not.toBe(fx.credA.user);
      expect(props.credentialId).not.toBe(fx.credA.team);
      expect(blob).not.toContain(seed.A.team.slug);
      expect(blob).not.toContain(seed.A.owner.email);
      expect(blob).not.toContain(tag(seed.A));
      const teams = (props.teams as { id: number }[]).map((t) => t.id);
      expect(teams).not.toContain(seed.A.team.id);
    });

    it("installation page: anonymous is sent to login", async () => {
      session.current = null;
      const res = await installationSSR(ctx({ slug: APP, teamId: String(seed.A.team.id) }, "accounts"));
      expect(res).toEqual({ redirect: { permanent: false, destination: "/auth/login" } });
    });
  });

  describe("Organization and OrganizationMember / publicSlug: /team/<orgSlug> landing", () => {
    const render = async (slug: string) => {
      try {
        const el = (await OrgLandingPage({ params: Promise.resolve({ slug }) } as never)) as {
          props: { landing: Record<string, unknown> };
        };
        return { kind: "rendered" as const, landing: el.props.landing };
      } catch (e) {
        const digest = (e as { digest?: string }).digest ?? "";
        if (digest === "NEXT_NOT_FOUND" || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;404"))
          return { kind: "notFound" as const };
        throw e;
      }
    };

    it("org landing: an unknown slug and a non-active org both return notFound", async () => {
      expect((await render(`cc13-${seed.runId}-nope`)).kind).toBe("notFound");
      await withTwPlatform(prisma, "CC-13 suspend A", (tx) =>
        tx.organization.update({ where: { id: seed.A.twOrg.id }, data: { status: "suspended" } })
      );
      try {
        expect((await render(seed.A.twOrg.slug)).kind).toBe("notFound");
      } finally {
        await withTwPlatform(prisma, "CC-13 restore A", (tx) =>
          tx.organization.update({ where: { id: seed.A.twOrg.id }, data: { status: "active" } })
        );
      }
    });

    it("org landing: A's active landing exposes only public fields, none of B's data", async () => {
      const out = await render(seed.A.twOrg.slug);
      expect(out.kind).toBe("rendered");
      const landing = (out as { landing: Record<string, unknown> }).landing;
      const blob = JSON.stringify(landing);
      expect(Object.keys(landing).sort()).toEqual(["members", "org", "teamLinks"]);
      expect(Object.keys(landing.org as object).sort()).toEqual(["accentColor", "logoUrl", "name", "slug"]);
      expect(blob).not.toContain("@cc13.test");
      expect(blob).not.toContain(seed.A.owner.email);
      expect(blob).not.toContain(seed.A.twOrg.id);
      expect(blob).not.toContain(tag(seed.B));
      expect(blob).not.toContain(seed.B.twOrg.id);
    });

    it("org landing: members list leaves out locked, hidden-only and cross-org-username members", async () => {
      const out = await render(seed.A.twOrg.slug);
      const landing = (out as unknown as { landing: { members: { username: string; links: { href: string }[] }[] } })
        .landing;
      const names = landing.members.map((m) => m.username);
      expect(names).toContain(fx.aPublicUser.username);
      expect(names).not.toContain(fx.aLockedUser.username);
      expect(names).not.toContain(fx.aHiddenUser.username);
      expect(names).not.toContain(fx.aSharedName.username);
      for (const m of landing.members) {
        expect(Object.keys(m).sort()).toEqual(["href", "links", "name", "username"]);
        for (const l of m.links) expect(l.href).not.toContain(fx.aHiddenEvent);
      }
      const b = await render(seed.B.twOrg.slug);
      const bNames = (b as unknown as { landing: { members: { username: string }[] } }).landing.members.map(
        (m) => m.username
      );
      for (const u of [fx.aPublicUser.username, fx.aLockedUser.username, fx.aHiddenUser.username])
        expect(bNames).not.toContain(u);
    });
  });

  describe("TwCustomHostname / publicSlug: custom-host resolver", () => {
    const repo = () => new CustomHostResolverRepository(prisma);
    const setStatus = (orgId: string, status: "pending_dns" | "failed" | "active") =>
      withTwPlatform(prisma, "CC-13 hostname status", (tx) =>
        tx.twCustomHostname.update({ where: { orgId }, data: { status } })
      );

    it("custom host resolver: A's pending_dns and failed hostnames resolve to nothing, active resolves to A only", async () => {
      expect(await resolveCustomHost(repo(), { host: fx.hostA })).toEqual({
        ok: true,
        orgSlug: seed.A.twOrg.slug,
      });
      for (const status of ["pending_dns", "failed"] as const) {
        await setStatus(seed.A.twOrg.id, status);
        try {
          expect(await resolveCustomHost(repo(), { host: fx.hostA })).toEqual({ ok: false });
        } finally {
          await setStatus(seed.A.twOrg.id, "active");
        }
      }
      const b = await resolveCustomHost(repo(), { host: fx.hostB });
      expect(b).toEqual({ ok: true, orgSlug: seed.B.twOrg.slug });
      expect(JSON.stringify(b)).not.toContain(seed.A.twOrg.slug);
      // Unknown hosts and A's host with different case/trailing dot never reach B.
      expect(await resolveCustomHost(repo(), { host: `unknown-${seed.runId}.cc13.example.com` })).toEqual({
        ok: false,
      });
      expect(await resolveCustomHost(repo(), { host: `${fx.hostA.toUpperCase()}.` })).toEqual({
        ok: true,
        orgSlug: seed.A.twOrg.slug,
      });
    });

    it("custom host resolver: B's active host refuses A's users and A's team slug", async () => {
      expect(await resolveCustomHost(repo(), { host: fx.hostB, users: [seed.A.owner.username] })).toEqual({
        ok: false,
      });
      // A username that also exists in B is refused on both hosts (one foreign match denies).
      expect(await resolveCustomHost(repo(), { host: fx.hostA, users: [fx.aSharedName.username] })).toEqual({
        ok: false,
      });
      expect(await resolveCustomHost(repo(), { host: fx.hostB, team: seed.A.team.slug })).toEqual({
        ok: false,
      });
      expect(await resolveCustomHost(repo(), { host: fx.hostA, team: seed.A.team.slug })).toMatchObject({
        ok: true,
      });
    });
  });

  describe("Avatar / publicSlug: /api/avatar/[uuid] (uuid knowledge is the capability)", () => {
    const get = async (uuid: string) => {
      const { GET } = await import("../../app/api/avatar/[uuid]/route");
      return GET(new NextRequest(`http://localhost/api/avatar/${uuid}`), {
        params: Promise.resolve({ uuid }),
      } as never);
    };

    it("avatar route: an unknown uuid gets the fallback redirect, never an image", async () => {
      const res = await get(randomUUID());
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain("/avatar.svg");
      // A's team id / user id are not capabilities.
      const byId = await get(String(seed.A.owner.id));
      expect(byId.status).toBe(302);
    });

    it("avatar route: A's uuid returns only A's image, B's uuid only B's (uuid knowledge is the capability)", async () => {
      const a = await get(`${fx.avatarA.key}.png`);
      expect(a.status).toBe(200);
      const aBody = Buffer.from(await a.arrayBuffer()).toString();
      expect(aBody).toBe(`PNG-${fx.avatarA.marker}`);
      expect(aBody).not.toContain(fx.avatarB.marker);
      const b = await get(fx.avatarB.key);
      expect(Buffer.from(await b.arrayBuffer()).toString()).toBe(`PNG-${fx.avatarB.marker}`);
    });
  });
});
