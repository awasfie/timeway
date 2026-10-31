import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ManageLink } from "./ManageLink";

const guest = {
  name: "G",
  email: "guest@example.com",
  timeZone: "UTC",
  language: { translate: (k: string) => k, locale: "en" },
};
const calEvent = {
  uid: "uid-1",
  type: "30min",
  title: "Demo",
  bookerUrl: "https://timeway.test",
  startTime: "2026-10-22T10:00:00Z",
  endTime: "2026-10-22T10:30:00Z",
  organizer: { ...guest, email: "host@timeway.test" },
  attendees: [guest],
};

describe("ManageLink (LK-T6a)", () => {
  it("renders li.gy reschedule/cancel links when composed", () => {
    const ev = {
      ...calEvent,
      ligyLinks: { "guest@example.com": { cancel: "https://li.gy/c1", reschedule: "https://li.gy/r1" } },
    };
    const html = renderToStaticMarkup(<ManageLink calEvent={ev as never} attendee={guest as never} />);
    expect(html).toContain('href="https://li.gy/c1"');
    expect(html).toContain('href="https://li.gy/r1"');
    expect(html).not.toContain("timeway.test/reschedule");
  });

  it("keeps the long links without overrides", () => {
    const html = renderToStaticMarkup(<ManageLink calEvent={calEvent as never} attendee={guest as never} />);
    expect(html).toContain("https://timeway.test/reschedule/uid-1");
    expect(html).toContain("https://timeway.test/booking/uid-1");
    expect(html).not.toContain("li.gy");
  });

  it("never shows a link the long path hides (disableCancelling)", () => {
    const ev = {
      ...calEvent,
      disableCancelling: true,
      ligyLinks: { "guest@example.com": { cancel: "https://li.gy/c1" } },
    };
    const html = renderToStaticMarkup(<ManageLink calEvent={ev as never} attendee={guest as never} />);
    expect(html).not.toContain("li.gy/c1");
  });
});
