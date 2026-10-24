"use client";

import { createContext, useContext } from "react";

/**
 * The few session fields the public booking pages read. The booking route group resolves the session on
 * the server and passes only these, so the page ships neither next-auth/react nor the rest of the session
 * in its RSC payload (WC-TW-6c-9b).
 */
export type BookingSession = {
  hasValidLicense: boolean;
  user: {
    id: number;
    email: string | null;
    name: string | null;
    username: string | null;
    locale?: string;
  };
};

type BookingSessionValue = { data: BookingSession | null };

// Outside the booking route group (platform atoms, tests) there is no provider: behave as logged out.
const BookingSessionContext = createContext<BookingSessionValue>({ data: null });

export function BookingSessionProvider({
  session,
  children,
}: {
  session: BookingSession | null;
  children: React.ReactNode;
}) {
  return <BookingSessionContext.Provider value={{ data: session }}>{children}</BookingSessionContext.Provider>;
}

/** Same `{ data }` shape as next-auth's useSession, with `null` (never `undefined`) for a logged-out visitor. */
export function useBookingSession(): BookingSessionValue {
  return useContext(BookingSessionContext);
}
