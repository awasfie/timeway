import { describe, expect, test } from "vitest";
import { needsRenewal, renewBefore } from "../renewalPolicy";

const now = new Date("2026-10-08T12:00:00Z");
const h = 60 * 60 * 1000;

describe("renewalPolicy (WC-TW-2)", () => {
  test("google renews within 12 h of expiry", () => {
    expect(needsRenewal("google_calendar", new Date(now.getTime() + 11 * h), now)).toBe(true);
    expect(needsRenewal("google_calendar", new Date(now.getTime() + 13 * h), now)).toBe(false);
  });
  test("graph renews when < 15 min left", () => {
    expect(needsRenewal("office365_calendar", new Date(now.getTime() + 10 * 60 * 1000), now)).toBe(true);
    expect(needsRenewal("office365_calendar", new Date(now.getTime() + 20 * 60 * 1000), now)).toBe(false);
  });
  test("missing expiration always renews; unknown integration renews only when expired", () => {
    expect(needsRenewal("google_calendar", null, now)).toBe(true);
    expect(needsRenewal("other", new Date(now.getTime() + 1000), now)).toBe(false);
    expect(renewBefore("other", now).getTime()).toBe(now.getTime());
  });
});
