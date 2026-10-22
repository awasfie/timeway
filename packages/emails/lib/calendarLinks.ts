import { getVideoCallUrlFromCalEvent } from "@calcom/lib/CalEventParser";
import type { CalendarEvent } from "@calcom/types/Calendar";
import type { TFunction } from "i18next";

type LinkEvent = Pick<
  CalendarEvent,
  | "title"
  | "startTime"
  | "endTime"
  | "uid"
  | "location"
  | "bookerUrl"
  | "videoCallData"
  | "additionalInformation"
>;

const compact = (iso: string) =>
  new Date(iso)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

const where = (e: LinkEvent) => getVideoCallUrlFromCalEvent(e) || e.location || "";

/** Add-to-calendar links for the confirmation email (TW-MAIL-2). Google, Outlook and a hosted .ics (Apple). */
export function getCalendarLinks(e: LinkEvent, t?: TFunction) {
  const loc = where(e);
  const details = loc ? `${t ? t("join_meeting") : "Join"}: ${loc}` : "";
  const google = `https://calendar.google.com/calendar/render?${new URLSearchParams({
    action: "TEMPLATE",
    text: e.title,
    dates: `${compact(e.startTime)}/${compact(e.endTime)}`,
    details,
    location: loc,
  }).toString()}`;
  const outlook = `https://outlook.live.com/calendar/0/deeplink/compose?${new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: e.title,
    startdt: new Date(e.startTime).toISOString(),
    enddt: new Date(e.endTime).toISOString(),
    body: details,
    location: loc,
  }).toString()}`;
  const base = (e.bookerUrl || "https://timeway.co").replace(/\/$/, "");
  const ics = e.uid ? `${base}/api/ics/${encodeURIComponent(e.uid)}` : null;
  return { google, outlook, ics };
}
