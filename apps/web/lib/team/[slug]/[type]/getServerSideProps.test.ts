import { SchedulingType } from "@calcom/prisma/enums";
import type { GetServerSidePropsContext } from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = "6f1c2b1e-3c4d-4e5f-8a9b-0c1d2e3f4a5b";

const prismaMock = vi.hoisted(() => ({
  // TW-T9.2b2: runSsrWithPublicTwOrg resolves the org via tw_resolve_org_for_team_slug.
  $queryRaw: vi.fn(),
  team: { findFirst: vi.fn() },
  eventType: { findUniqueOrThrow: vi.fn() },
}));

vi.mock("@calcom/prisma", () => ({ prisma: prismaMock, default: prismaMock }));
vi.mock("@lib/handleOrgRedirect", () => ({ handleOrgRedirect: vi.fn().mockResolvedValue(null) }));
vi.mock("@calcom/features/auth/lib/getServerSession", () => ({ getServerSession: vi.fn() }));
vi.mock("@calcom/features/bookings/lib/get-booking", () => ({ getBookingForReschedule: vi.fn() }));

import { getServerSideProps } from "./getServerSideProps";

const ctx = (query: Record<string, string> = {}): GetServerSidePropsContext =>
  ({
    req: { headers: { host: "timeway.co" } },
    params: { slug: "awstreams", type: "intro-call-ar" },
    query: { slug: "awstreams", type: "intro-call-ar", ...query },
  }) as unknown as GetServerSidePropsContext;

const team = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  isPrivate: false,
  hideBranding: false,
  parent: null,
  logoUrl: null,
  name: "AWstreams",
  slug: "awstreams",
  brandColor: null,
  darkBrandColor: null,
  theme: null,
  isOrganization: false,
  organizationSettings: null,
  eventTypes: [
    {
      id: 11,
      title: "Intro call",
      isInstantEvent: false,
      schedulingType: SchedulingType.ROUND_ROBIN as SchedulingType,
      metadata: {},
      length: 30,
      hidden: false,
      disableCancelling: false,
      disableRescheduling: false,
      allowReschedulingCancelledBookings: false,
      interfaceLanguage: "ar",
      hosts: [{ user: { name: "Ahmed", username: "ahmed", email: "a@example.com" } }],
    },
  ],
  ...overrides,
});

describe("team/[slug]/[type] getServerSideProps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$queryRaw.mockResolvedValue([{ id: 1, twOrgId: ORG }]);
  });

  it("returns notFound without reading the team when the slug resolves to no org", async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);
    expect(await getServerSideProps(ctx())).toEqual({ notFound: true });
    expect(prismaMock.team.findFirst).not.toHaveBeenCalled();
  });

  it("resolves the org from the team slug through the definer function", async () => {
    prismaMock.team.findFirst.mockResolvedValue(null);
    await getServerSideProps(ctx());
    expect(prismaMock.$queryRaw).toHaveBeenCalledTimes(1);
    const [strings, key] = prismaMock.$queryRaw.mock.calls[0];
    expect((strings as string[]).join("?")).toContain("public.tw_resolve_org_for_team_slug(");
    expect(key).toBe("awstreams");
  });

  it("returns notFound when the team or event type does not exist", async () => {
    prismaMock.team.findFirst.mockResolvedValue(null);
    expect(await getServerSideProps(ctx())).toEqual({ notFound: true });
  });

  it("only looks up top-level teams by slug (no org parent)", async () => {
    prismaMock.team.findFirst.mockResolvedValue(null);
    await getServerSideProps(ctx());
    expect(prismaMock.team.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { slug: "awstreams", parent: null } })
    );
  });

  it("returns notFound for managed event types", async () => {
    const t = team();
    t.eventTypes[0].schedulingType = SchedulingType.MANAGED;
    prismaMock.team.findFirst.mockResolvedValue(t);
    expect(await getServerSideProps(ctx())).toEqual({ notFound: true });
  });

  it("returns Booker props with the team entity and event interface language", async () => {
    prismaMock.team.findFirst.mockResolvedValue(team());
    const result = await getServerSideProps(ctx());
    if (!("props" in result) || !result.props) throw new Error("expected props");
    expect(result.props.eventData.eventTypeId).toBe(11);
    expect(result.props.eventData.interfaceLanguage).toBe("ar");
    expect(result.props.eventData.entity).toMatchObject({ teamSlug: "awstreams", orgSlug: null });
    expect(result.props.eventData.users).toEqual([{ username: "ahmed", name: "Ahmed" }]);
    expect(result.props.user).toBe("awstreams");
    expect(result.props.slug).toBe("intro-call-ar");
  });

  it("hides host names for private teams", async () => {
    prismaMock.team.findFirst.mockResolvedValue(team({ isPrivate: true }));
    const result = await getServerSideProps(ctx());
    if (!("props" in result) || !result.props) throw new Error("expected props");
    expect(result.props.eventData.users).toEqual([]);
  });

  it("redirects to the booking page when rescheduling is disabled", async () => {
    const t = team();
    t.eventTypes[0].disableRescheduling = true;
    prismaMock.team.findFirst.mockResolvedValue(t);
    expect(await getServerSideProps(ctx({ rescheduleUid: "abc" }))).toEqual({
      redirect: { destination: "/booking/abc", permanent: false },
    });
  });
});
