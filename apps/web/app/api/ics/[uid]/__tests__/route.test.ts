import { describe, expect, test, vi } from "vitest";
import { GET } from "../route";

const findUnique = vi.fn();
vi.mock("@calcom/prisma", () => ({
  default: { booking: { findUnique: (...a: unknown[]) => findUnique(...a) } },
  prisma: { booking: { findUnique: (...a: unknown[]) => findUnique(...a) } },
}));

const UID = "u9FvTSuB2d4No3kc2nAeX9";
const CAMV_URL = `https://camv.co/rooms/tw-${UID}?hq=true`;

const booking = (overrides: Record<string, unknown>) => ({
  uid: UID,
  iCalUID: `${UID}@timeway.co`,
  title: "15 min meeting",
  startTime: new Date("2026-11-02T10:00:00Z"),
  endTime: new Date("2026-11-02T10:15:00Z"),
  location: "integrations:camv",
  status: "ACCEPTED",
  references: [],
  user: { name: "Organizer", email: "organizer@example.com", timeZone: "Asia/Dubai" },
  attendees: [{ name: "Guest", email: "guest@example.com", timeZone: "Africa/Cairo" }],
  ...overrides,
});

const call = async () => {
  const res = await GET({} as never, { params: Promise.resolve({ uid: UID }) });
  return { status: res.status, body: await res.text() };
};

// ICS folds lines at 75 octets; unfold before matching.
const unfold = (s: string) => s.replace(/\r?\n[ \t]/g, "");
const locationLine = (ics: string) =>
  unfold(ics)
    .split(/\r?\n/)
    .find((l) => l.startsWith("LOCATION:"));

describe("GET /api/ics/[uid] LOCATION (TW-ICS-1a)", () => {
  test("camv booking with a livekit_video reference -> camv room URL", async () => {
    findUnique.mockResolvedValueOnce(
      booking({ references: [{ type: "livekit_video", meetingUrl: CAMV_URL }] })
    );
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(locationLine(body)).toBe(`LOCATION:${CAMV_URL}`);
  });

  test("camv booking with only an empty daily_video reference -> derived camv room URL", async () => {
    findUnique.mockResolvedValueOnce(booking({ references: [{ type: "daily_video", meetingUrl: "" }] }));
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(locationLine(body)).toBe(`LOCATION:${CAMV_URL}`);
    expect(unfold(body)).not.toContain("integrations:");
  });

  test("camv booking with no references -> derived camv room URL", async () => {
    findUnique.mockResolvedValueOnce(booking({ references: [] }));
    const { body } = await call();
    expect(locationLine(body)).toBe(`LOCATION:${CAMV_URL}`);
  });

  test("never emits a raw integrations:* key for other apps", async () => {
    findUnique.mockResolvedValueOnce(booking({ location: "integrations:zoom", references: [] }));
    const { body } = await call();
    expect(unfold(body)).not.toContain("integrations:");
  });
});
