import type { CalendarEvent } from "@calcom/types/Calendar";
import type { TFunction } from "i18next";
import { getCalendarLinks } from "../../lib/calendarLinks";

const linkStyle = { color: "#101010", fontWeight: 600, textDecoration: "underline" } as const;

export function AddToCalendarLinks(props: { calEvent: CalendarEvent; t?: TFunction }) {
  const { google, outlook, ics } = getCalendarLinks(props.calEvent, props.t);
  return (
    <div
      data-testid="add-to-calendar"
      style={{
        fontFamily: "Roboto, Helvetica, sans-serif",
        fontSize: "14px",
        lineHeight: "24px",
        textAlign: "center",
        color: "#3E3E3E",
        paddingTop: "16px",
      }}>
      <p style={{ margin: "0 0 4px 0" }}>{props.t ? props.t("add_to_calendar") : "Add to calendar"}</p>
      <a href={google} style={linkStyle}>
        Google
      </a>
      {" · "}
      <a href={outlook} style={linkStyle}>
        Outlook
      </a>
      {ics ? (
        <>
          {" · "}
          <a href={ics} style={linkStyle}>
            Apple / .ics
          </a>
        </>
      ) : null}
    </div>
  );
}
