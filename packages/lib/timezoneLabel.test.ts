import { describe, expect, it } from "vitest";
import { canonicalTimezone, getTimezoneLabel, isValidTimezone } from "./timezoneLabel";

describe("timezoneLabel", () => {
  it.each([
    ["Africa/Cairo", "Africa/Cairo"],
    ["Asia/Riyadh", "Asia/Riyadh"],
    ["Asia/Dubai", "Asia/Dubai"],
    ["America/New_York", "America/New York"],
    ["Europe/London", "Europe/London"],
    ["Australia/Sydney", "Australia/Sydney"],
    ["America/Argentina/Buenos_Aires", "America/Argentina/Buenos Aires"],
  ])("labels %s as %s", (tz, label) => {
    expect(getTimezoneLabel(tz)).toBe(label);
  });

  it("maps the Asia/Calcutta legacy link to Asia/Kolkata", () => {
    expect(canonicalTimezone("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(getTimezoneLabel("Asia/Calcutta")).toBe("Asia/Kolkata");
  });

  it("falls back to the raw value for an unknown zone instead of throwing", () => {
    expect(isValidTimezone("Mars/Olympus_Mons")).toBe(false);
    expect(getTimezoneLabel("Mars/Olympus_Mons")).toBe("Mars/Olympus Mons");
  });
});
