/**
 * CC-13 (extended) coverage manifest — hand-kept (WC-TW-7a).
 *
 * One entry per model in models.generated.json; each entry names, per surface, either:
 *   - a probe id "<repo-relative path>.integration-test.ts > <test name>" (or an API v2 e2e spec),
 *   - { none: "<why this surface cannot reach the model>" }, or
 *   - { pending: "WC-TW-7b" | "WC-TW-7c" | "WC-TW-7d" } while the probe card is open.
 *
 * coverage.test.ts fails on a missing/extra model, a missing surface, an unknown pending card,
 * or a probe id whose file or test name does not exist. Pending is reported, never counted as covered.
 */

export const SURFACES = ["pages", "trpc", "apiV2", "apiKey", "webhook", "publicSlug", "job"] as const;
export type Surface = (typeof SURFACES)[number];

export const PENDING_CARDS = ["WC-TW-7b", "WC-TW-7c", "WC-TW-7d"] as const;
export type PendingCard = (typeof PENDING_CARDS)[number];

export type ProbeId = `${string} > ${string}`;
export type SurfaceCoverage = ProbeId | { none: string } | { pending: PendingCard };
export type ModelCoverage = Record<Surface, SurfaceCoverage>;

/** Card ownership of surfaces not yet probed (decided in WC-TW-7, t_e9b16842). */
const OWNER: Record<Surface, PendingCard> = {
  pages: "WC-TW-7b",
  trpc: "WC-TW-7b",
  publicSlug: "WC-TW-7b",
  apiV2: "WC-TW-7c",
  apiKey: "WC-TW-7c",
  webhook: "WC-TW-7c",
  job: "WC-TW-7c",
};

const pending = (overrides: Partial<ModelCoverage> = {}): ModelCoverage => {
  const entry = {} as ModelCoverage;
  for (const s of SURFACES) entry[s] = overrides[s] ?? { pending: OWNER[s] };
  return entry;
};

export const manifest: Record<string, ModelCoverage> = {
  AccessCode: pending(),
  ActivationEvent: pending(),
  Agent: pending(),
  ApiKey: pending(),
  Attribute: pending(),
  Avatar: pending(),
  Booking: pending(),
  BookingDenormalized: pending(),
  BookingReport: pending(),
  BookingTimeStatus: pending(),
  BookingTimeStatusDenormalized: pending(),
  CalAiPhoneNumber: pending(),
  Credential: pending(),
  CreditBalance: pending(),
  DSyncData: pending(),
  DSyncTeamGroupMapping: pending(),
  DelegationCredential: pending(),
  EventType: pending(),
  FilterSegment: pending(),
  InstantMeetingToken: pending(),
  IntegrationAttributeSync: pending(),
  InternalNotePreset: pending(),
  Membership: pending(),
  MonthlyProration: pending(),
  OrgApiKey: pending(),
  Organization: pending(),
  OrganizationBilling: pending(),
  OrganizationMember: pending(),
  OrganizationOnboarding: pending(),
  OrganizationSettings: pending(),
  PlatformOAuthClient: pending(),
  Profile: pending(),
  Role: pending(),
  Schedule: pending(),
  SeatChangeLog: pending(),
  Team: pending(),
  TeamBilling: pending(),
  TeamFeatures: pending(),
  User: pending(),
  VerificationToken: pending(),
  VerifiedEmail: pending(),
  VerifiedNumber: pending(),
  Watchlist: pending(),
  Webhook: pending(),
  WrongAssignmentReport: pending(),
};
