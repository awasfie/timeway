import { getBookingUrl, getCancelLink, getRescheduleLink } from "@calcom/lib/CalEventParser";
import type { CalendarEvent, Person } from "@calcom/types/Calendar";
import type { BookingServiceLinks, LigyDeps } from "./serviceLinks";
import { composeBookingServiceLinks, getLigyConfig } from "./serviceLinks";

/** Cap on recipients composed per send; beyond it recipients keep the long URL (bounded fan-out to Ligy). */
export const LIGY_MAX_RECIPIENTS = 20;

export const ligyRecipientKey = (email: string | null | undefined) => (email ?? "").trim().toLowerCase();

/** The li.gy override for one recipient, if any. Callers fall back to their own long URL when undefined. */
export function ligyLinksFor(
  calEvent: Pick<CalendarEvent, "ligyLinks">,
  person: Pick<Person, "email"> | null | undefined
): BookingServiceLinks | undefined {
  if (!person || !calEvent.ligyLinks) return undefined;
  return calEvent.ligyLinks[ligyRecipientKey(person.email)];
}

/**
 * LK-T6a: compose each recipient's booking / cancel / reschedule link through Ligy (sourceRef `booking:<uid>`) and
 * attach them as `calEvent.ligyLinks`. Flag off, platform bookings and missing uid return the event unchanged (same
 * object). All calls run in parallel, so the added latency is bounded by one 300 ms Ligy timeout (CC-43).
 */
export async function attachLigyLinks<T extends CalendarEvent>(calEvent: T, deps: LigyDeps = {}): Promise<T> {
  const cfg = { ...getLigyConfig(), ...deps.config };
  if (!cfg.enabled || !calEvent.uid || calEvent.platformClientId) return calEvent;

  const seen = new Set<string>();
  const people: Person[] = [];
  for (const p of [...calEvent.attendees, calEvent.organizer, ...(calEvent.team?.members ?? [])]) {
    const key = ligyRecipientKey(p?.email);
    if (!key || seen.has(key) || people.length >= LIGY_MAX_RECIPIENTS) continue;
    seen.add(key);
    people.push(p);
  }

  try {
    return await composeAll(calEvent, people, { ...deps, config: cfg });
  } catch {
    // Never let link shortening break a booking notification (CC-43): long URLs on any unexpected error.
    return calEvent;
  }
}

async function composeAll<T extends CalendarEvent>(
  calEvent: T,
  people: Person[],
  deps: LigyDeps
): Promise<T> {
  const booking = getBookingUrl(calEvent);
  const entries = await Promise.all(
    people.map(async (person) => {
      const links = await composeBookingServiceLinks(
        {
          bookingUid: calEvent.uid,
          links: {
            booking,
            cancel: calEvent.disableCancelling ? undefined : getCancelLink(calEvent, person),
            reschedule: calEvent.disableRescheduling
              ? undefined
              : getRescheduleLink({ calEvent, attendee: person }),
          },
        },
        deps
      );
      return [ligyRecipientKey(person.email), links ?? {}] as const;
    })
  );
  return { ...calEvent, ligyLinks: Object.fromEntries(entries) };
}
