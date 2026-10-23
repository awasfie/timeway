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

/** apiKey surface (WC-TW-7c-3): cal_ keys resolve to one User; this model is not reachable through any key-authenticated route. */
const API_KEY_NONE = {
  none: "API-key auth only resolves a cal_ key to its owning User and twk_ org keys are no v2 credential; no key-authenticated route reads or writes this model",
};

const pending = (overrides: Partial<ModelCoverage> = {}): ModelCoverage => {
  const entry = {} as ModelCoverage;
  for (const s of SURFACES) entry[s] = overrides[s] ?? { pending: OWNER[s] };
  return entry;
};

export const manifest: Record<string, ModelCoverage> = {
  AccessCode: pending({ apiKey: API_KEY_NONE }),
  Agent: pending({ apiKey: API_KEY_NONE }),
  ApiKey: pending({ apiKey: "apps/web/test/cc13/api-key.integration-test.ts > B cannot list A's api keys" }),
  Attribute: pending({ apiKey: API_KEY_NONE }),
  Avatar: pending({ apiKey: API_KEY_NONE }),
  Booking: pending({
    apiV2: "apps/api/v2/src/platform/cc13-cross-tenant.e2e-spec.ts > B cannot read A's booking references",
    apiKey:
      "apps/api/v2/src/platform/cc13-cross-tenant-api-key.e2e-spec.ts > B's API key lists none of A's bookings, event types or schedules",
  }),
  BookingDenormalized: pending({ apiKey: API_KEY_NONE }),
  BookingReport: pending({ apiKey: API_KEY_NONE }),
  BookingTimeStatus: pending({ apiKey: API_KEY_NONE }),
  BookingTimeStatusDenormalized: pending({ apiKey: API_KEY_NONE }),
  CalAiPhoneNumber: pending({ apiKey: API_KEY_NONE }),
  Credential: pending({ apiKey: API_KEY_NONE }),
  CreditBalance: pending({ apiKey: API_KEY_NONE }),
  DSyncData: pending({ apiKey: API_KEY_NONE }),
  DSyncTeamGroupMapping: pending({ apiKey: API_KEY_NONE }),
  DelegationCredential: pending({ apiKey: API_KEY_NONE }),
  EventType: pending({
    apiV2: "apps/api/v2/src/platform/cc13-cross-tenant.e2e-spec.ts > B cannot update A's event type",
    apiKey:
      "apps/api/v2/src/platform/cc13-cross-tenant-api-key.e2e-spec.ts > B's API key cannot update or delete A's event type and schedule",
  }),
  FilterSegment: pending({ apiKey: API_KEY_NONE }),
  InstantMeetingToken: pending({ apiKey: API_KEY_NONE }),
  IntegrationAttributeSync: pending({ apiKey: API_KEY_NONE }),
  InternalNotePreset: pending({ apiKey: API_KEY_NONE }),
  Membership: pending({ apiKey: API_KEY_NONE }),
  MonthlyProration: pending({ apiKey: API_KEY_NONE }),
  OrgApiKey: pending({
    apiKey: "apps/web/test/cc13/api-key.integration-test.ts > B's org context cannot read A's org api key",
  }),
  Organization: pending({ apiKey: API_KEY_NONE }),
  OrganizationBilling: pending({ apiKey: API_KEY_NONE }),
  OrganizationMember: pending({ apiKey: API_KEY_NONE }),
  OrganizationOnboarding: pending({ apiKey: API_KEY_NONE }),
  OrganizationSettings: pending({ apiKey: API_KEY_NONE }),
  PlatformOAuthClient: pending({ apiKey: API_KEY_NONE }),
  Profile: pending({ apiKey: API_KEY_NONE }),
  Role: pending({ apiKey: API_KEY_NONE }),
  Schedule: pending({
    apiV2: "apps/api/v2/src/platform/cc13-cross-tenant.e2e-spec.ts > B cannot update A's schedule",
    apiKey:
      "apps/api/v2/src/platform/cc13-cross-tenant-api-key.e2e-spec.ts > B's API key cannot update or delete A's event type and schedule",
  }),
  SeatChangeLog: pending({ apiKey: API_KEY_NONE }),
  Team: pending({ apiKey: API_KEY_NONE }),
  TeamBilling: pending({ apiKey: API_KEY_NONE }),
  TeamFeatures: pending({ apiKey: API_KEY_NONE }),
  TwCustomHostname: pending({ apiKey: API_KEY_NONE }),
  User: pending({ apiKey: API_KEY_NONE }),
  VerificationToken: pending({ apiKey: API_KEY_NONE }),
  VerifiedEmail: pending({ apiKey: API_KEY_NONE }),
  VerifiedNumber: pending({ apiKey: API_KEY_NONE }),
  Watchlist: pending({ apiKey: API_KEY_NONE }),
  Webhook: pending({ apiKey: API_KEY_NONE }),
  WrongAssignmentReport: pending({ apiKey: API_KEY_NONE }),
};
