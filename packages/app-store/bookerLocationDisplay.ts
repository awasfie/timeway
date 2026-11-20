import type { TFunction } from "i18next";

import type { LocationObject } from "./locations";

/**
 * Display-only view of every booker location type: the three fields the public booker reads
 * (label, icon, which LocationObject key holds the value). The booker imports this instead of
 * ./locations, which pulls the full booker-apps metadata (descriptions, keys, regexes) and zod
 * into the first-load bundle (WC-TW-6n-4a).
 *
 * Kept in sync with ./locations by bookerLocationDisplay.test.ts, which fails on any drift and
 * prints the up-to-date map to paste here.
 */
export type BookerLocationDisplay = {
  label: string;
  iconUrl: string;
  defaultValueVariable?: string;
};

export const bookerLocationDisplay: Record<string, BookerLocationDisplay> = {
  "attendeeInPerson": { label: "in_person_attendee_address", iconUrl: "/map-pin-dark.svg", defaultValueVariable: "attendeeAddress" },
  "somewhereElse": { label: "custom_attendee_location", iconUrl: "/message-pin.svg", defaultValueVariable: "somewhereElse" },
  "inPerson": { label: "in_person", iconUrl: "/map-pin-dark.svg", defaultValueVariable: "address" },
  "conferencing": { label: "organizer_default_conferencing_app", iconUrl: "/link.svg", defaultValueVariable: "hostDefault" },
  "link": { label: "link_meeting", iconUrl: "/link.svg", defaultValueVariable: "link" },
  "phone": { label: "attendee_phone_number", iconUrl: "/phone.svg", defaultValueVariable: "phone" },
  "userPhone": { label: "phone_call", iconUrl: "/phone.svg", defaultValueVariable: "hostPhoneNumber" },
  "integrations:campfire_video": { label: "Campfire", iconUrl: "/app-store/campfire/icon.svg", defaultValueVariable: "link" },
  "integrations:daily": { label: "Cal Video", iconUrl: "/app-store/dailyvideo/icon.svg", defaultValueVariable: "link" },
  "integrations:demodesk_video": { label: "Demodesk", iconUrl: "/app-store/demodesk/icon.svg", defaultValueVariable: "link" },
  "integrations:dialpad_video": { label: "dialpad", iconUrl: "/app-store/dialpad/icon.svg", defaultValueVariable: "link" },
  "integrations:discord_video": { label: "Discord", iconUrl: "/app-store/discord/icon.svg", defaultValueVariable: "link" },
  "integrations:eightxeight_video": { label: "8x8", iconUrl: "/app-store/eightxeight/icon.svg", defaultValueVariable: "link" },
  "integrations:element-call_video": { label: "Element Call", iconUrl: "/app-store/element-call/icon.svg", defaultValueVariable: "link" },
  "integrations:facetime_video": { label: "Facetime", iconUrl: "/app-store/facetime/icon.svg", defaultValueVariable: "link" },
  "integrations:google:meet": { label: "Google Meet", iconUrl: "/app-store/googlevideo/logo.webp", defaultValueVariable: "link" },
  "integrations:horizon-workrooms_video": { label: "Horizon Workrooms", iconUrl: "/app-store/horizon-workrooms/icon.svg", defaultValueVariable: "link" },
  "integrations:huddle01_video": { label: "Huddle01 Video", iconUrl: "/app-store/huddle01video/icon.svg", defaultValueVariable: "link" },
  "integrations:jelly_conferencing": { label: "Jelly", iconUrl: "/app-store/jelly/icon.svg", defaultValueVariable: "link" },
  "integrations:jitsi": { label: "Jitsi Video", iconUrl: "/app-store/jitsivideo/icon.svg", defaultValueVariable: "link" },
  "integrations:camv": { label: "Camv Video", iconUrl: "/app-store/livekitvideo/icon.svg", defaultValueVariable: "link" },
  "integrations:lyra": { label: "Lyra Meeting", iconUrl: "/app-store/lyra/icon.svg", defaultValueVariable: "link" },
  "integrations:mirotalk_video": { label: "Mirotalk", iconUrl: "/app-store/mirotalk/icon.svg", defaultValueVariable: "link" },
  "integrations:nextcloudtalk_conferencing": { label: "Nextcloud Talk", iconUrl: "/app-store/nextcloudtalk/icon.svg", defaultValueVariable: "link" },
  "integrations:office365_video": { label: "MS Teams", iconUrl: "/app-store/office365video/icon.svg", defaultValueVariable: "link" },
  "integrations:ping_video": { label: "Ping.gg", iconUrl: "/app-store/ping/icon.svg", defaultValueVariable: "link" },
  "integrations:riverside_video": { label: "Riverside Video", iconUrl: "/app-store/riverside/icon-dark.svg", defaultValueVariable: "link" },
  "integrations:roam_video": { label: "Roam", iconUrl: "/app-store/roam/icon.png", defaultValueVariable: "link" },
  "integrations:salesroom_video": { label: "Salesroom", iconUrl: "/app-store/salesroom/icon.svg", defaultValueVariable: "link" },
  "integrations:shimmer_video": { label: "Shimmer Video", iconUrl: "/app-store/shimmervideo/icon.png", defaultValueVariable: "link" },
  "integrations:signal_video": { label: "Signal", iconUrl: "/app-store/signal/icon.svg", defaultValueVariable: "link" },
  "integrations:sirius_video_video": { label: "Sirius Video", iconUrl: "/app-store/sirius_video/icon-dark.svg", defaultValueVariable: "link" },
  "integrations:skype_video": { label: "Skype", iconUrl: "/app-store/skype/icon.svg", defaultValueVariable: "link" },
  "integrations:sylaps_video": { label: "Sylaps", iconUrl: "/app-store/sylapsvideo/icon.svg", defaultValueVariable: "link" },
  "integrations:tandem": { label: "Tandem Video", iconUrl: "/app-store/tandemvideo/icon.svg", defaultValueVariable: "link" },
  "integrations:telegram_video": { label: "Telegram", iconUrl: "/app-store/telegram/icon.svg", defaultValueVariable: "link" },
  "integrations:event-type-location-video-static_video": { label: "EventType Location Video - Static", iconUrl: "/app-store/templates/event-type-location-video-static/icon.svg", defaultValueVariable: "link" },
  "integrations:webex_video": { label: "Webex", iconUrl: "/app-store/webex//icon.ico", defaultValueVariable: "link" },
  "integrations:whatsapp_video": { label: "WhatsApp", iconUrl: "/app-store/whatsapp/icon.svg", defaultValueVariable: "link" },
  "integrations:whereby_video": { label: "Whereby Video", iconUrl: "/app-store/whereby/icon-dark.svg", defaultValueVariable: "link" },
  "integrations:zoom": { label: "Zoom Video", iconUrl: "/app-store/zoomvideo/icon.svg", defaultValueVariable: "link" },
};

const translateAbleKeys = [
  "in_person_attendee_address",
  "in_person",
  "attendee_phone_number",
  "link_meeting",
  "phone_call",
  "organizer_default_conferencing_app",
  "somewhere_else",
  "custom_attendee_location",
];

export const getBookerLocationByType = (locationType: string | undefined | null) =>
  locationType ? bookerLocationDisplay[locationType] : undefined;

type DisplayLocation = Pick<LocationObject, "type"> & Partial<Omit<LocationObject, "type">>;

/** Same result as getTranslatedLocation() in ./locations, for the booker's display map. */
export const getBookerTranslatedLocation = (
  location: DisplayLocation,
  display: BookerLocationDisplay | undefined,
  t: TFunction
) => {
  if (!display) return null;
  const valueKey = display.defaultValueVariable;
  const locationKey = valueKey
    ? String((location as Record<string, unknown>)[valueKey] || display.label || "")
    : "";
  if (location.type.startsWith("integrations:")) return display.label;
  return translateAbleKeys.includes(locationKey) ? t(locationKey) : locationKey;
};
