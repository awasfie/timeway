import { describe, expect, it } from "vitest";

import { getCalendarLinks } from "./calendarLinks";

const ev = {
  title: "Intro call between Ahmed and A",
  startTime: "2026-10-18T08:00:00Z",
  endTime: "2026-10-18T08:30:00Z",
  uid: "abcDEF1234567890",
  location: "https://meet.google.com/abc-defg-hij",
  bookerUrl: "https://timeway.co",
} as Parameters<typeof getCalendarLinks>[0];

describe("getCalendarLinks", () => {
  it("builds Google, Outlook and .ics links", () => {
    const l = getCalendarLinks(ev);
    expect(l.google).toContain("calendar.google.com/calendar/render?action=TEMPLATE");
    expect(l.google).toContain("dates=20261018T080000Z%2F20261018T083000Z");
    expect(l.outlook).toContain("outlook.live.com/calendar/0/deeplink/compose");
    expect(l.outlook).toContain("startdt=2026-10-18T08%3A00%3A00.000Z");
    expect(l.ics).toBe("https://timeway.co/api/ics/abcDEF1234567890");
  });
  it("camv booking without videoCallData -> camv room URL in Google and Outlook links", () => {
    const camv = "https://camv.co/rooms/tw-abcDEF1234567890?hq=true";
    const l = getCalendarLinks({ ...ev, location: "integrations:camv", videoCallData: undefined });
    for (const url of [l.google, l.outlook]) {
      const q = new URL(url).searchParams;
      expect(q.get("location")).toBe(camv);
      expect(decodeURIComponent(url)).not.toContain("integrations:");
    }
    expect(new URL(l.google).searchParams.get("details")).toBe(`Join: ${camv}`);
    expect(new URL(l.outlook).searchParams.get("body")).toBe(`Join: ${camv}`);
  });
  it("omits .ics without uid", () => {
    expect(getCalendarLinks({ ...ev, uid: undefined }).ics).toBeNull();
  });
});
