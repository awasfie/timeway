import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@calcom/types/Calendar";
import LiveKitVideoApiAdapter, { camvRoomUrlForBooking } from "./VideoApiAdapter";

describe("LiveKit/Camv adapter updateMeeting", () => {
  const ref = { type: "livekit_video", meetingId: "tw-OLD", meetingUrl: "https://camv.co/rooms/tw-OLD?hq=true" };

  it("points a rescheduled booking at its NEW uid room", async () => {
    const r = await LiveKitVideoApiAdapter().updateMeeting(ref as never, { uid: "NEW" } as CalendarEvent);
    expect(r.id).toBe("tw-NEW");
    expect(r.url).toBe(camvRoomUrlForBooking("NEW"));
    expect(r.url).not.toContain("OLD");
  });

  it("keeps the stored reference when the event has no uid", async () => {
    const r = await LiveKitVideoApiAdapter().updateMeeting(ref as never, {} as CalendarEvent);
    expect(r.url).toBe(ref.meetingUrl);
  });
});
