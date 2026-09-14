import process from "node:process";
import type { CalendarEvent } from "@calcom/types/Calendar";
import type { PartialReference } from "@calcom/types/EventManager";
import type { VideoApiAdapter, VideoCallData } from "@calcom/types/VideoApiAdapter";
import { metadata } from "../_metadata";

/**
 * LiveKitProvider (Camv v0) — TW-T7 per Execution Bible v11.1.
 *
 * v0 does NOT call the LiveKit server API to pre-create the room: LiveKit
 * rooms auto-create on first participant join, so all we need here is a
 * deterministic room name + meeting URL at /rooms/<roomName> (matches the
 * camv repo's actual Next.js route at app/rooms/[roomName]/page.tsx).
 * Access tokens are minted server-side by the Camv app itself at join time
 * (see camv repo's token endpoint), which validates the booking exists and
 * the time window (±grace) before issuing a token — this adapter never
 * handles API keys/secrets directly.
 */
const CAMV_BASE_URL: string = process.env.CAMV_BASE_URL || "https://camv.co";

function roomNameForBooking(bookingUid: string): string {
  return `tw-${bookingUid}`;
}

const LiveKitVideoApiAdapter = (): VideoApiAdapter => {
  return {
    getAvailability: () => {
      return Promise.resolve([]);
    },
    createMeeting: async (eventData: CalendarEvent): Promise<VideoCallData> => {
      const bookingUid = eventData.uid;
      if (!bookingUid) {
        throw new Error(
          "LiveKitVideoApiAdapter.createMeeting: eventData.uid is required to mint a room name"
        );
      }
      const roomName = roomNameForBooking(bookingUid);
      // hq=true: real bookings should default to the higher-quality video
      // preset (up to 1080p simulcast / 4K capture) rather than the demo
      // page's conservative default (720p capture / 540p-216p simulcast).
      // Per Ahmed: "screen resolution is not good" on real calls.
      const url = `${CAMV_BASE_URL}/rooms/${roomName}?hq=true`;

      return Promise.resolve({
        type: metadata.type,
        id: roomName,
        password: "",
        url,
        // provider_ref stored for future cancel/analytics per TW-T7.2 —
        // v0 has no server-side room object to cancel (auto-create/auto-expire),
        // but keeping the ref lets future versions call LiveKit's DeleteRoom API.
      });
    },
    deleteMeeting: async (): Promise<void> => {
      // v0: no-op. LiveKit rooms are ephemeral (auto-created on join, closed
      // when empty) — nothing to delete server-side yet. A future version
      // may explicitly close the room via the LiveKit Room Service API here.
      return Promise.resolve();
    },
    updateMeeting: (bookingRef: PartialReference): Promise<VideoCallData> => {
      return Promise.resolve({
        type: metadata.type,
        id: bookingRef.meetingId as string,
        password: (bookingRef.meetingPassword as string) || "",
        url: bookingRef.meetingUrl as string,
      });
    },
  };
};

export default LiveKitVideoApiAdapter;
