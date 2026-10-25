import { describe, expect, it } from "vitest";
import { bookYourselfUrl, missingSeedEventTypes, ONBOARDING_EVENT_TYPES, ONBOARDING_STEP } from "./seed";

const t = (k: string) => `t:${k}`;

describe("WC-DX-10c timeway onboarding seed", () => {
  it("seeds exactly two visible event types on an empty account", () => {
    const out = missingSeedEventTypes([], t);
    expect(out).toEqual([
      { title: "t:15min_meeting", slug: "15min", length: 15 },
      { title: "t:30min_meeting", slug: "30min", length: 30 },
    ]);
    expect(out.some((e) => "hidden" in e)).toBe(false);
  });

  it("is idempotent: a second run after the first creates nothing", () => {
    const first = missingSeedEventTypes([], t);
    expect(missingSeedEventTypes(first, t)).toEqual([]);
  });

  it("only fills the gap when the user already has one of the slugs", () => {
    expect(missingSeedEventTypes([{ slug: "30min" }, { slug: "demo" }], t).map((e) => e.slug)).toEqual([
      "15min",
    ]);
  });

  it("does nothing while the event-type list is still loading", () => {
    expect(missingSeedEventTypes(undefined, t)).toEqual([]);
  });

  it("keeps the onboarding-kit step ids and the i18n keys stable", () => {
    expect(ONBOARDING_STEP).toEqual({
      publishBookingPage: "publish_booking_page",
      bookYourself: "book_yourself",
    });
    expect(ONBOARDING_EVENT_TYPES.map((e) => e.titleKey)).toEqual(["15min_meeting", "30min_meeting"]);
  });

  it("builds a prefilled book-yourself link in both locales", () => {
    const en = bookYourselfUrl({
      bookerUrl: "https://timeway.co/",
      username: "sara",
      name: "Sara Ali",
      email: "sara@example.com",
    });
    expect(en).toBe("https://timeway.co/sara/15min?name=Sara+Ali&email=sara%40example.com");
    const ar = new URL(
      bookYourselfUrl({
        bookerUrl: "https://timeway.co",
        username: "sara",
        name: "سارة علي",
      }) ?? ""
    );
    expect(ar.pathname).toBe("/sara/15min");
    expect(ar.searchParams.get("name")).toBe("سارة علي");
    expect(ar.searchParams.has("lang")).toBe(false);
  });

  it("returns null without a username (no public page yet)", () => {
    expect(bookYourselfUrl({ bookerUrl: "https://timeway.co", username: null })).toBeNull();
  });
});
