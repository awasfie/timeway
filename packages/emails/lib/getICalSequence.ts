/**
 * SEQUENCE for the next attendee-visible revision of a booking's calendar event (reschedule,
 * location change, request-reschedule, cancel). Pass `null` for a brand-new booking.
 */
const getNextICalSequence = (current: number | null | undefined) => (current ?? 0) + 1;

export const getICalSequenceForBooking = (original: { iCalSequence?: number | null } | null | undefined) =>
  original ? getNextICalSequence(original.iCalSequence) : 0;

export default getNextICalSequence;
