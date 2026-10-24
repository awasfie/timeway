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
  AccessCode: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  Agent: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  ApiKey: pending({ apiV2: { none: "/v2/api-keys/refresh acts only on the key presented in the caller's own Authorization header; cross-tenant key use is the apiKey surface (WC-TW-7c-3)" } }),
  Attribute: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  Avatar: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  Booking: pending({ apiV2: "apps/api/v2/src/platform/cc13-cross-tenant.e2e-spec.ts > B cannot read A's booking references" }),
  BookingDenormalized: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  BookingReport: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  BookingTimeStatus: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  BookingTimeStatusDenormalized: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  CalAiPhoneNumber: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  Credential: pending({ apiV2: "apps/api/v2/src/platform/cc13-cross-tenant-orgs.e2e-spec.ts > B cannot disconnect A's calendar credential" }),
  CreditBalance: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  DSyncData: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  DSyncTeamGroupMapping: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  DelegationCredential: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  EventType: pending({ apiV2: "apps/api/v2/src/platform/cc13-cross-tenant.e2e-spec.ts > B cannot update A's event type" }),
  FilterSegment: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  InstantMeetingToken: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  IntegrationAttributeSync: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  InternalNotePreset: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  Membership: pending({ apiV2: "apps/api/v2/src/platform/cc13-cross-tenant-orgs.e2e-spec.ts > B cannot update A's managed user or membership" }),
  MonthlyProration: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  OrgApiKey: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  Organization: pending({ apiV2: "apps/api/v2/src/platform/cc13-cross-tenant-orgs.e2e-spec.ts > B cannot update A's OAuth client" }),
  OrganizationBilling: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  OrganizationMember: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  OrganizationOnboarding: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  OrganizationSettings: pending({ apiV2: { none: "read internally by the admin-API guard (fetchOrgAdminApiStatus); no route returns or writes it" } }),
  PlatformOAuthClient: pending({ apiV2: "apps/api/v2/src/platform/cc13-cross-tenant-orgs.e2e-spec.ts > B cannot read A's OAuth client" }),
  Profile: pending({ apiV2: "apps/api/v2/src/platform/cc13-cross-tenant-orgs.e2e-spec.ts > B reads only its own profile via /me" }),
  Role: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  Schedule: pending({ apiV2: "apps/api/v2/src/platform/cc13-cross-tenant.e2e-spec.ts > B cannot update A's schedule" }),
  SeatChangeLog: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  Team: pending({ apiV2: { none: "apps/api/v2 has no team controller; team/org rows are reached only through the org-scoped OAuthClientGuard/RolesGuard, probed under Organization and PlatformOAuthClient" } }),
  TeamBilling: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  TeamFeatures: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  TwCustomHostname: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  User: pending({ apiV2: "apps/api/v2/src/platform/cc13-cross-tenant-orgs.e2e-spec.ts > B cannot read A's managed user" }),
  VerificationToken: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  VerifiedEmail: pending({ apiV2: "apps/api/v2/src/platform/cc13-cross-tenant-orgs.e2e-spec.ts > B cannot read A's verified email by id" }),
  VerifiedNumber: pending({ apiV2: "apps/api/v2/src/platform/cc13-cross-tenant-orgs.e2e-spec.ts > B cannot read A's verified phone by id" }),
  Watchlist: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
  Webhook: pending(),
  WrongAssignmentReport: pending({ apiV2: { none: "no apps/api/v2 route reads or writes this model" } }),
};
