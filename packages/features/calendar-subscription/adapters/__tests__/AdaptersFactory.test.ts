import { beforeEach, describe, expect, test } from "vitest";
import { DefaultAdapterFactory } from "../AdaptersFactory";
import { GoogleCalendarSubscriptionAdapter } from "../GoogleCalendarSubscription.adapter";
import { Office365CalendarSubscriptionAdapter } from "../Office365CalendarSubscription.adapter";

describe("DefaultAdapterFactory", () => {
  let factory: DefaultAdapterFactory;

  beforeEach(() => {
    factory = new DefaultAdapterFactory();
  });

  describe("get", () => {
    test("should return GoogleCalendarSubscriptionAdapter for google_calendar", () => {
      const adapter = factory.get("google_calendar");

      expect(adapter).toBeInstanceOf(GoogleCalendarSubscriptionAdapter);
    });

    test("should return Office365CalendarSubscriptionAdapter for office365_calendar", () => {
      const adapter = factory.get("office365_calendar");

      expect(adapter).toBeInstanceOf(Office365CalendarSubscriptionAdapter);
    });

    test("should return the same instance for multiple calls (singleton)", () => {
      const adapter1 = factory.get("google_calendar");
      const adapter2 = factory.get("google_calendar");

      expect(adapter1).toBe(adapter2);
    });

    test("should throw error for unsupported provider", () => {
      expect(() => {
        factory.get("unsupported_calendar" as never);
      }).toThrow("No adapter found for provider unsupported_calendar");
    });
  });

  describe("getProviders", () => {
    test("should return all available providers", () => {
      const providers = factory.getProviders();

      expect(providers).toEqual(["google_calendar", "office365_calendar"]);
    });

    test("should return array with correct length", () => {
      const providers = factory.getProviders();

      expect(providers).toHaveLength(2);
    });

    test("every provider resolves to an adapter (WC-TW-2: office365 is subscribed by the cron)", () => {
      for (const provider of factory.getProviders()) {
        expect(() => factory.get(provider)).not.toThrow();
      }
    });
  });

  describe("getGenericCalendarSuffixes", () => {
    test("keeps the Google exclusions and adds none for office365 (Graph ids are opaque)", () => {
      expect(factory.getGenericCalendarSuffixes()).toEqual([
        "@group.v.calendar.google.com",
        "@import.calendar.google.com",
        "@resource.calendar.google.com",
      ]);
    });

    test("WC-TW-4f: user-created Google secondary calendars (@group.calendar.google.com) are not excluded", () => {
      const suffixes = factory.getGenericCalendarSuffixes();
      const secondary = "c_0b1f2e3d4c5b6a7980@group.calendar.google.com";
      expect(suffixes).not.toContain("@group.calendar.google.com");
      expect(suffixes.some((s) => secondary.endsWith(s))).toBe(false);
      // holidays stay excluded
      expect(suffixes.some((s) => "en.usa#holiday@group.v.calendar.google.com".endsWith(s))).toBe(true);
    });
  });
});
