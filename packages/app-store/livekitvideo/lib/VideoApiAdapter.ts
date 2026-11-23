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

export function roomNameForBooking(bookingUid: string): string {
  return `tw-${bookingUid}`;
}

/**
 * Canonical Camv room URL for a booking. hq=true: real bookings default to
 * the higher-quality video preset (up to 1080p simulcast / 4K capture) rather
 * than the demo page's conservative default (720p capture / 540p-216p
 * simulcast). Per Ahmed: "screen resolution is not good" on real calls.
 * Single source of the URL format (TW-ICS-1a): the adapter, /api/ics and the
 * email ICS attachment all go through here.
 */
export function camvRoomUrlForBooking(bookingUid: string): string {
  return `${CAMV_BASE_URL}/rooms/${roomNameForBooking(bookingUid)}?hq=true`;
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
      const url = camvRoomUrlForBooking(bookingUid);

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
    updateMeeting: (bookingRef: PartialReference, eventData?: CalendarEvent): Promise<VideoCallData> => {
      // A reschedule creates a NEW booking uid and cancels the old one. The Camv token endpoint
      // rejects cancelled bookings, so the room must follow the CURRENT booking uid; reusing the
      // old reference would send guests to a dead room (invite-integrity probe t_bb76cf1f).
      const bookingUid = eventData?.uid;
      if (bookingUid) {
        return Promise.resolve({
          type: metadata.type,
          id: roomNameForBooking(bookingUid),
          password: "",
          url: camvRoomUrlForBooking(bookingUid),
        });
      }
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
