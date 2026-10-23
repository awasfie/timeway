import { getServerSession } from "@calcom/features/auth/lib/getServerSession";
import type { Session } from "next-auth";

import type { BookingSession } from "./booking-session";

export function toBookingSession(session: Session | null): BookingSession | null {
  if (!session?.user) return null;
  const { id, email, name, username, locale } = session.user;
  return {
    hasValidLicense: session.hasValidLicense ?? false,
    user: { id, email: email ?? null, name: name ?? null, username: username ?? null, locale: locale ?? undefined },
  };
}

export async function getBookingSession(
  req: Parameters<typeof getServerSession>[0]["req"]
): Promise<BookingSession | null> {
  return toBookingSession(await getServerSession({ req }));
}
