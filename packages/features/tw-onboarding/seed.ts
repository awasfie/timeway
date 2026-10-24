/**
 * WC-DX-10c: Timeway onboarding seed (Bible WC-36 WC-DX-10 step 1: public page with
 * 2 event types + a "book yourself" link).
 *
 * Step ids are the @salesos/onboarding-kit contract (salesos PR 335, commit bdf862e). The kit is
 * not vendored yet, so these mirror it by hand; never rename them, they are persisted.
 */
export const ONBOARDING_STEP = {
  publishBookingPage: "publish_booking_page",
  bookYourself: "book_yourself",
} as const;

export interface SeedEventType {
  /** i18n key, already present in en and ar common.json. */
  titleKey: "15min_meeting" | "30min_meeting";
  slug: string;
  length: number;
}

// Two visible types only: the old upstream seed also made a hidden "secret" type, which
// is not part of the public page and just clutters a new user's list.
export const ONBOARDING_EVENT_TYPES: readonly SeedEventType[] = Object.freeze([
  Object.freeze({ titleKey: "15min_meeting", slug: "15min", length: 15 }),
  Object.freeze({ titleKey: "30min_meeting", slug: "30min", length: 30 }),
]);

/**
 * Idempotent by slug: a resumed or double-submitted onboarding only creates what is
 * missing, and never fights a user who already made their own "15min".
 * `existing` undefined means the list has not loaded; seeding then would duplicate.
 */
export function missingSeedEventTypes(
  existing: readonly { slug: string }[] | undefined,
  t: (key: string) => string
): { title: string; slug: string; length: number }[] {
  if (!existing) return [];
  const have = new Set(existing.map((e) => e.slug));
  return ONBOARDING_EVENT_TYPES.filter((e) => !have.has(e.slug)).map((e) => ({
    title: t(e.titleKey),
    slug: e.slug,
    length: e.length,
  }));
}

/**
 * The owner's own public booking link, prefilled so booking yourself is two clicks.
 * A self-booking never counts as activation: tw-activation isExternalBooking rejects
 * attendees who are org members. No locale param: the booking page renders in the
 * event owner's interfaceLanguage / the visitor's request locale.
 */
export function bookYourselfUrl(input: {
  bookerUrl: string;
  username: string | null | undefined;
  slug?: string;
  name?: string | null;
  email?: string | null;
}): string | null {
  if (!input.username) return null;
  const base = input.bookerUrl.replace(/\/+$/, "");
  const url = new URL(
    `${base}/${encodeURIComponent(input.username)}/${encodeURIComponent(input.slug ?? ONBOARDING_EVENT_TYPES[0].slug)}`
  );
  if (input.name) url.searchParams.set("name", input.name);
  if (input.email) url.searchParams.set("email", input.email);
  return url.toString();
}
