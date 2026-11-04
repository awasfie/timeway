/**
 * CC-13 public-slug probes, WC-TW-7b-3: the unauthenticated booking pages (/[user]/[type],
 * /team/[slug]/[type]) and the booking insert behind them, run in-process against the real DB.
 * A probe passes when anonymous visitors and tenant B's session get nothing of A's hidden or
 * private data beyond what the public page shows anyone, AND A's rows are unchanged.
 *
 * Org subdomain routing: both loaders hardcode currentOrgDomain=null / isValidOrgDomain=false and
 * look teams up with parent: null, so a request "from B's org" (host, orgSlug, orgRedirection) has
 * no code path that reads it. The org-context probes below prove the B tag is ignored, rather than
 * claiming a routing surface that does not exist.
 */

import { randomUUID } from "node:crypto";
import { createBooking } from "@calcom/features/bookings/lib/handleNewBooking/createBooking";
import { getEventTypesFromDB } from "@calcom/features/bookings/lib/handleNewBooking/getEventTypesFromDB";
import { SchedulingType } from "@calcom/prisma/enums";
import type { GetServerSidePropsContext } from "next";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Cc13Seed, SeededTenant } from "./seed";
import { seedCc13Tenants } from "./seed";
import { expectUnchanged, prisma } from "./trpc-harness";

const session = vi.hoisted(() => ({ current: null as null | { user: { id: number } } }));
vi.mock("@calcom/features/auth/lib/getServerSession", () => ({
  getServerSession: vi.fn(async () => session.current),
}));

import { getServerSideProps as teamTypeSSR } from "../../lib/team/[slug]/[type]/getServerSideProps";
import { getServerSideProps as userTypeSSR } from "../../server/lib/[user]/[type]/getServerSideProps";
import { getServerSideProps as userSSR } from "../../server/lib/[user]/getServerSideProps";

let seed: Cc13Seed;
let n = 0;
const tag = (t: SeededTenant) => `cc13-${seed.runId}-${t.label.toLowerCase()}`;

type Fixture = {
  solo: { id: number; username: string; email: string };
  hiddenPersonal: { id: number; slug: string };
  privateTeam: { id: number; slug: string };
  privateTeamType: { id: number; slug: string };
  hiddenTeamType: { id: number; slug: string };
  managedTeamType: { id: number; slug: string };
};
let fx: Fixture;

/** A personal (non-org) user of tenant A with a hidden event type, plus a private team of A's. */
async function seedPublicFixtures(t: SeededTenant): Promise<Fixture> {
  const solo = await prisma.user.create({
    data: {
      email: `${tag(t)}-solo@cc13.test`,
      username: `${tag(t)}-solo`,
      name: `CC-13 ${t.label} solo`,
      twOrgId: t.twOrg.id,
    },
    select: { id: true, username: true, email: true },
  });
  const hiddenPersonal = await prisma.eventType.create({
    data: {
      title: `${tag(t)} hidden personal`,
      slug: `${tag(t)}-hidden-personal`,
      length: 30,
      hidden: true,
      owner: { connect: { id: solo.id } },
      users: { connect: { id: solo.id } },
      twOrgId: t.twOrg.id,
    },
    select: { id: true, slug: true },
  });
  const privateTeam = await prisma.team.create({
    data: { name: `CC-13 ${t.label} private`, slug: `${tag(t)}-private`, isPrivate: true },
    select: { id: true, slug: true },
  });
  await prisma.membership.createMany({
    data: [
      { teamId: privateTeam.id, userId: t.owner.id, role: "OWNER", accepted: true },
      { teamId: privateTeam.id, userId: t.member.id, role: "MEMBER", accepted: true },
    ],
  });
  const mkTeamType = (slug: string, extra: { hidden?: boolean; schedulingType?: SchedulingType }) =>
    prisma.eventType.create({
      data: {
        title: `${tag(t)} ${slug}`,
        slug: `${tag(t)}-${slug}`,
        length: 30,
        teamId: privateTeam.id,
        twOrgId: t.twOrg.id,
        schedulingType: extra.schedulingType ?? SchedulingType.ROUND_ROBIN,
        hidden: extra.hidden ?? false,
        hosts: {
          create: [
            { userId: t.owner.id, isFixed: false },
            { userId: t.member.id, isFixed: false },
          ],
        },
      },
      select: { id: true, slug: true },
    });
  return {
    solo: { id: solo.id, username: solo.username ?? "", email: solo.email },
    hiddenPersonal,
    privateTeam: { id: privateTeam.id, slug: privateTeam.slug ?? "" },
    privateTeamType: await mkTeamType("private-rr", {}),
    hiddenTeamType: await mkTeamType("hidden-rr", { hidden: true }),
    managedTeamType: await mkTeamType("managed", { schedulingType: SchedulingType.MANAGED }),
  };
}

async function cleanupPublicFixtures() {
  if (!fx) return;
  await prisma.booking.deleteMany({ where: { uid: { startsWith: `cc13-${seed.runId}-` } } });
  await prisma.host.deleteMany({ where: { eventType: { teamId: fx.privateTeam.id } } });
  await prisma.eventType.deleteMany({ where: { teamId: fx.privateTeam.id } });
  await prisma.membership.deleteMany({ where: { teamId: fx.privateTeam.id } });
  await prisma.team.deleteMany({ where: { id: fx.privateTeam.id } });
}

beforeAll(async () => {
  seed = await seedCc13Tenants();
  fx = await seedPublicFixtures(seed.A);
}, 60_000);

afterAll(async () => {
  await cleanupPublicFixtures();
  await seed?.cleanup();
});

/** B "visiting from its own org": subdomain host plus every org hint a request can carry. */
const bOrgHints = () => ({
  host: `${seed.B.team.slug}.timeway.co`,
  query: { orgSlug: seed.B.team.slug, orgRedirection: "true" },
});

function ctx(
  params: Record<string, string>,
  opts: { host?: string; query?: Record<string, string> } = {}
): GetServerSidePropsContext {
  return {
    req: { headers: { host: opts.host ?? "timeway.co" }, cookies: {} },
    res: {},
    params,
    query: { ...params, ...(opts.query ?? {}) },
    resolvedUrl: "/",
  } as unknown as GetServerSidePropsContext;
}

async function asViewer<T>(viewer: "anon" | "B", fn: () => Promise<T>): Promise<T> {
  session.current = viewer === "B" ? { user: { id: seed.B.owner.id } } : null;
  try {
    return await fn();
  } finally {
    session.current = null;
  }
}

/**
 * Everything a public page must never hand out about A's people. A's own twOrgId is not listed:
 * getPublicEvent selects it on purpose for the Booker's first-party analytics (WC-TW-9c), so it is
 * public for A's own page; the org-context probes assert B's id never appears instead.
 */
const aSecrets = () => [seed.A.owner.email, seed.A.member.email, fx.solo.email, seed.A.booking.uid];

function expectNoSecrets(result: unknown, extra: string[] = []) {
  const json = JSON.stringify(result);
  for (const s of [...aSecrets(), ...extra]) {
    expect(json.includes(s), `public page leaked ${s.slice(0, 24)}…`).toBe(false);
  }
}

const readEventType = (id: number) => () => prisma.eventType.findUnique({ where: { id } });

describe("CC-13 public slugs: anonymous and tenant B vs tenant A (WC-TW-7b-3)", () => {
  describe("/[user]/[type]", () => {
    it("hidden personal event: anonymous and B see the same public props, no A emails or booking uids", async () => {
      await expectUnchanged(readEventType(fx.hiddenPersonal.id), async () => {
        const params = { user: fx.solo.username, type: fx.hiddenPersonal.slug };
        const anon = await asViewer("anon", () => userTypeSSR(ctx(params)));
        const asB = await asViewer("B", () => userTypeSSR(ctx(params)));
        expectNoSecrets(anon);
        expectNoSecrets(asB);
        // B's session must not unlock anything an anonymous visitor does not get.
        expect(JSON.parse(JSON.stringify(asB))).toEqual(JSON.parse(JSON.stringify(anon)));
      });
    });

    it("hidden personal event: A's profile listing omits it for anonymous and B", async () => {
      for (const viewer of ["anon", "B"] as const) {
        const res = await asViewer(viewer, () =>
          userSSR(ctx({ user: fx.solo.username }, { query: { redirect: "false" } }))
        );
        const slugs = ((res as { props?: { eventTypes?: { slug: string }[] } }).props?.eventTypes ?? []).map(
          (e) => e.slug
        );
        expect(slugs).not.toContain(fx.hiddenPersonal.slug);
        expectNoSecrets(res);
      }
    });

    it("B's reschedule uid for A's booking attaches no booking to A's page", async () => {
      const res = await asViewer("B", () =>
        userTypeSSR(
          ctx(
            { user: fx.solo.username, type: fx.hiddenPersonal.slug },
            { query: { rescheduleUid: seed.A.booking.uid } }
          )
        )
      );
      const props = (res as { props?: { booking?: unknown; rescheduleUid?: unknown } }).props;
      // A's booking belongs to another event type: the loader may redirect or 404, never embed it.
      expect(props?.booking ?? null).toBeNull();
      expectNoSecrets(res);
    });

    it("org context: B-org hints cannot resolve A's event into B's org", async () => {
      const res = await asViewer("B", () =>
        userTypeSSR(ctx({ user: fx.solo.username, type: fx.hiddenPersonal.slug }, bOrgHints()))
      );
      const json = JSON.stringify(res);
      expect(json.includes(seed.B.team.slug), "B org slug resolved into A's page").toBe(false);
      expect(json.includes(seed.B.twOrg.id)).toBe(false);
      expectNoSecrets(res);
    });

    it("org context: A's org-member usernames do not resolve on the top-level path", async () => {
      // Seed users carry organizationId (isOrganization team); without org routing they must 404.
      const res = await asViewer("B", () =>
        userTypeSSR(ctx({ user: seed.A.owner.username, type: seed.A.eventType.slug }, bOrgHints()))
      );
      expect(res).toEqual({ notFound: true });
    });
  });

  describe("/team/[slug]/[type]", () => {
    it("private team: anonymous and B get no member names, usernames or emails", async () => {
      await expectUnchanged(readEventType(fx.privateTeamType.id), async () => {
        const params = { slug: fx.privateTeam.slug, type: fx.privateTeamType.slug };
        for (const viewer of ["anon", "B"] as const) {
          const res = await asViewer(viewer, () => teamTypeSSR(ctx(params)));
          const users = (res as { props?: { eventData?: { users?: unknown[] } } }).props?.eventData?.users;
          expect(users).toEqual([]);
          expectNoSecrets(res, [seed.A.owner.username, seed.A.member.username]);
        }
      });
    });

    it("hidden team event in a private team: no host data and flagged hidden", async () => {
      const params = { slug: fx.privateTeam.slug, type: fx.hiddenTeamType.slug };
      for (const viewer of ["anon", "B"] as const) {
        const res = await asViewer(viewer, () => teamTypeSSR(ctx(params)));
        const ed = (res as { props?: { eventData?: { users?: unknown[]; hidden?: boolean } } }).props
          ?.eventData;
        expect(ed?.users).toEqual([]);
        expect(ed?.hidden).toBe(true);
        expectNoSecrets(res, [seed.A.owner.username, seed.A.member.username]);
      }
    });

    it("managed team event: notFound for anonymous and B", async () => {
      const params = { slug: fx.privateTeam.slug, type: fx.managedTeamType.slug };
      for (const viewer of ["anon", "B"] as const) {
        expect(await asViewer(viewer, () => teamTypeSSR(ctx(params)))).toEqual({ notFound: true });
      }
    });

    it("public team page: hosts expose name/username only, never emails", async () => {
      // A's org team (not private) with host rows: the loader selects host emails, it must drop them.
      const t = await prisma.eventType.create({
        data: {
          title: `${tag(seed.A)} pub-rr`,
          slug: `${tag(seed.A)}-pub-rr${++n}`,
          length: 30,
          teamId: seed.A.team.id,
          twOrgId: seed.A.twOrg.id,
          schedulingType: SchedulingType.ROUND_ROBIN,
          hosts: { create: [{ userId: seed.A.owner.id, isFixed: false }] },
        },
        select: { slug: true },
      });
      const res = await asViewer("B", () => teamTypeSSR(ctx({ slug: seed.A.team.slug, type: t.slug })));
      expectNoSecrets(res);
    });

    it("org context: B-org hints cannot resolve A's team event into B's org", async () => {
      const res = await asViewer("B", () =>
        teamTypeSSR(ctx({ slug: fx.privateTeam.slug, type: fx.privateTeamType.slug }, bOrgHints()))
      );
      const props = (res as { props?: { teamId?: number; eventData?: { entity?: { orgSlug?: unknown } } } })
        .props;
      expect(props?.teamId).toBe(fx.privateTeam.id);
      expect(props?.eventData?.entity?.orgSlug ?? null).toBeNull();
      expect(JSON.stringify(res).includes(seed.B.twOrg.id)).toBe(false);
    });

    it("org context: B's slug with A's event type slug does not resolve A's event", async () => {
      const res = await asViewer("B", () =>
        teamTypeSSR(ctx({ slug: seed.B.team.slug, type: seed.A.eventType.slug }, bOrgHints()))
      );
      expect(res).toEqual({ notFound: true });
    });
  });

  describe("booking insert", () => {
    it("createBooking with A's eventTypeId under B-org hints stamps A's twOrgId, never B's", async () => {
      const eventTypeData = await getEventTypesFromDB(seed.A.eventType.id);
      const organizer = await prisma.user.findUniqueOrThrow({
        where: { id: seed.A.owner.id },
        select: { id: true, email: true, name: true, username: true, timeZone: true, locale: true },
      });
      const uid = `${tag(seed.A)}-pub${++n}-${randomUUID().slice(0, 8)}`;
      const start = new Date(Date.UTC(2030, 3, 1, 9));
      const end = new Date(start.getTime() + 30 * 60_000);
      const lang = { locale: "en", translate: ((k: string) => k) as never };
      const booking = await createBooking({
        uid: uid as never,
        rescheduledBy: undefined,
        // Every org hint a public request can carry points at B.
        reqBody: {
          user: seed.B.owner.username,
          metadata: { orgSlug: seed.B.team.slug, twOrgId: seed.B.twOrg.id },
          recurringEventId: undefined,
        },
        eventType: {
          eventTypeData: eventTypeData as never,
          id: seed.A.eventType.id,
          slug: seed.A.eventType.slug,
          organizerUser: organizer as never,
          isConfirmedByDefault: true,
          paymentAppData: { price: 0 } as never,
        },
        input: {
          bookerEmail: `${tag(seed.A)}-booker@cc13.test`,
          rescheduleReason: undefined,
          smsReminderNumber: undefined,
          responses: null,
        },
        evt: {
          type: seed.A.eventType.slug,
          title: "CC-13 public booking",
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          organizer: { email: organizer.email, name: organizer.name ?? "", timeZone: "UTC", language: lang },
          attendees: [
            { email: `${tag(seed.A)}-booker@cc13.test`, name: "Booker", timeZone: "UTC", language: lang },
          ],
        } as never,
        originalRescheduledBooking: null,
      });
      const row = await prisma.booking.findUniqueOrThrow({
        where: { id: booking.id },
        select: { twOrgId: true, eventTypeId: true },
      });
      expect(row).toEqual({ twOrgId: seed.A.twOrg.id, eventTypeId: seed.A.eventType.id });
    });
  });
});
