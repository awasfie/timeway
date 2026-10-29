import type { Session } from "next-auth";
import { describe, expect, it, vi } from "vitest";

vi.mock("@calcom/features/auth/lib/getServerSession", () => ({
  getServerSession: vi.fn(),
}));

import { getServerSession } from "@calcom/features/auth/lib/getServerSession";

import { getBookingSession, toBookingSession } from "./getBookingSession";

const fullSession = {
  hasValidLicense: true,
  expires: "2099-01-01",
  upId: "usr-1",
  user: {
    id: 7,
    email: "owner@example.com",
    name: "Owner",
    username: "owner",
    locale: "de",
    role: "ADMIN",
    belongsToActiveTeam: true,
    impersonatedBy: { id: 1, role: "ADMIN" },
  },
} as unknown as Session;

describe("toBookingSession", () => {
  it("returns null for a logged-out visitor", () => {
    expect(toBookingSession(null)).toBeNull();
    expect(toBookingSession({ expires: "x" } as unknown as Session)).toBeNull();
  });

  it("keeps only the fields the booking pages read", () => {
    expect(toBookingSession(fullSession)).toEqual({
      hasValidLicense: true,
      user: { id: 7, email: "owner@example.com", name: "Owner", username: "owner", locale: "de" },
    });
  });

  it("normalises missing optional fields", () => {
    const session = { expires: "x", user: { id: 3 } } as unknown as Session;
    expect(toBookingSession(session)).toEqual({
      hasValidLicense: false,
      user: { id: 3, email: null, name: null, username: null, locale: undefined },
    });
  });
});

describe("getBookingSession", () => {
  it("resolves the server session for the request and maps it", async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce(fullSession);
    const req = { headers: {}, cookies: {} } as Parameters<typeof getBookingSession>[0];
    const result = await getBookingSession(req);
    expect(getServerSession).toHaveBeenCalledWith({ req });
    expect(result?.user.id).toBe(7);
  });

  it("returns null when there is no session", async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce(null);
    const req = { headers: {}, cookies: {} } as Parameters<typeof getBookingSession>[0];
    expect(await getBookingSession(req)).toBeNull();
  });
});
