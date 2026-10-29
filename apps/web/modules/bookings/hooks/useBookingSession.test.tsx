import { BookingSessionProvider, useBookingSession } from "@lib/booking-session";
import type { BookingSession } from "@lib/booking-session";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

function Probe() {
  const { data } = useBookingSession();
  return <span data-testid="probe">{data === null ? "null" : `${data.user.id}:${data.user.username}`}</span>;
}

describe("useBookingSession", () => {
  it("is null (not undefined) outside the provider, so logged-out is known on first render", () => {
    render(<Probe />);
    expect(screen.getByTestId("probe").textContent).toBe("null");
  });

  it("returns the server-resolved session inside the provider", () => {
    const session: BookingSession = {
      hasValidLicense: true,
      user: { id: 7, email: "owner@example.com", name: "Owner", username: "owner" },
    };
    render(
      <BookingSessionProvider session={session}>
        <Probe />
      </BookingSessionProvider>
    );
    expect(screen.getByTestId("probe").textContent).toBe("7:owner");
  });

  it("returns null inside the provider for a logged-out visitor", () => {
    render(
      <BookingSessionProvider session={null}>
        <Probe />
      </BookingSessionProvider>
    );
    expect(screen.getByTestId("probe").textContent).toBe("null");
  });
});
