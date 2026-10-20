import { dir } from "i18next";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  eventType: { findFirst: vi.fn() },
}));

vi.mock("@calcom/prisma", () => ({ prisma: prismaMock, default: prismaMock }));

import { getBookingPageLocale, parseTeamEventPath } from "./getBookingPageLocale";

describe("parseTeamEventPath", () => {
  it.each([
    ["/team/awstreams/intro-call-ar", { teamSlug: "awstreams", eventSlug: "intro-call-ar" }],
    ["/team/awstreams/demo-ar/embed", { teamSlug: "awstreams", eventSlug: "demo-ar" }],
    ["/team/awstreams/intro-call/", { teamSlug: "awstreams", eventSlug: "intro-call" }],
  ])("matches %s", (pathname, expected) => {
    expect(parseTeamEventPath(pathname)).toEqual(expected);
  });

  it.each([
    [null],
    [""],
    ["/"],
    ["/team/awstreams"],
    ["/team/awstreams/embed"],
    ["/ahmed/intro-call"],
    ["/team/awstreams/intro-call/extra/embed"],
    ["/booking/abc"],
  ])("ignores %s", (pathname) => {
    expect(parseTeamEventPath(pathname)).toBeNull();
  });
});

describe("getBookingPageLocale", () => {
  beforeEach(() => {
    prismaMock.eventType.findFirst.mockReset();
  });

  it("returns the event type's interfaceLanguage for an Arabic team event and its embed", async () => {
    prismaMock.eventType.findFirst.mockResolvedValue({ interfaceLanguage: "ar" });

    expect(await getBookingPageLocale("/team/awstreams/intro-call-ar")).toBe("ar");
    expect(await getBookingPageLocale("/team/awstreams/intro-call-ar/embed")).toBe("ar");
    expect(prismaMock.eventType.findFirst).toHaveBeenCalledWith({
      where: { slug: "intro-call-ar", team: { slug: "awstreams", parentId: null } },
      select: { interfaceLanguage: true },
    });
  });

  it("returns null when the event type has no interfaceLanguage (visitor locale applies)", async () => {
    prismaMock.eventType.findFirst.mockResolvedValue({ interfaceLanguage: null });
    expect(await getBookingPageLocale("/team/awstreams/intro-call")).toBeNull();

    prismaMock.eventType.findFirst.mockResolvedValue({ interfaceLanguage: "" });
    expect(await getBookingPageLocale("/team/awstreams/intro-call")).toBeNull();
  });

  it("returns null for an unknown event type", async () => {
    prismaMock.eventType.findFirst.mockResolvedValue(null);
    expect(await getBookingPageLocale("/team/awstreams/nope")).toBeNull();
  });

  it("does not query for non team-event paths", async () => {
    expect(await getBookingPageLocale("/event-types")).toBeNull();
    expect(await getBookingPageLocale(null)).toBeNull();
    expect(prismaMock.eventType.findFirst).not.toHaveBeenCalled();
  });

  it("falls back to null when the lookup throws", async () => {
    prismaMock.eventType.findFirst.mockRejectedValue(new Error("db down"));
    expect(await getBookingPageLocale("/team/awstreams/intro-call-ar")).toBeNull();
  });
});

describe("html direction for the resolved locale", () => {
  it("is rtl for ar and ltr for en", () => {
    expect(dir("ar")).toBe("rtl");
    expect(dir("en")).toBe("ltr");
  });
});
