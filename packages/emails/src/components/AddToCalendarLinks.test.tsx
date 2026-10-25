import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AddToCalendarLinks } from "./AddToCalendarLinks";

describe("AddToCalendarLinks", () => {
  it("renders Google, Outlook and .ics links", () => {
    const html = renderToStaticMarkup(
      <AddToCalendarLinks
        calEvent={
          {
            title: "Demo",
            startTime: "2026-10-18T08:00:00Z",
            endTime: "2026-10-18T08:30:00Z",
            uid: "abcDEF1234567890",
            location: "",
            bookerUrl: "https://timeway.co",
          } as never
        }
      />
    );
    expect(html).toContain("calendar.google.com/calendar/render");
    expect(html).toContain("outlook.live.com/calendar/0/deeplink/compose");
    expect(html).toContain("https://timeway.co/api/ics/abcDEF1234567890");
  });
});
