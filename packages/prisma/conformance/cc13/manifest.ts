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
  TwCustomHostname: pending(),
  User: pending(),
  VerificationToken: pending(),
  VerifiedEmail: pending(),
  VerifiedNumber: pending(),
  Watchlist: pending(),
  Webhook: pending(),
  WrongAssignmentReport: pending(),
};

/** WC-TW-7d negative-test ids and recorded gaps (kept apart from the model x surface matrix). */
export const negative = {
  invitations: {
    probes: [
      "apps/web/test/cc13/negative/invitations.integration-test.ts > an invite token for tenant B grants nothing in tenant A",
      "apps/web/test/cc13/negative/invitations.integration-test.ts > an invite token minted for A's invitee creates only a MEMBER membership in A, never an elevated role",
      "apps/web/test/cc13/negative/invitations.integration-test.ts > an existing member's invite cannot raise their role (pending ADMIN stays what the inviter set)",
    ],
    defects: {
      "CC13-D2": "signup with a team token does not check the token identifier against the signing-up email (it.fails)",
    },
    none: { bAdminInvitesIntoA: "no invite-creation endpoint (team invite router) on main" },
  },
  keyScopes: {
    probes: [
      "apps/web/test/cc13/negative/key-scopes.integration-test.ts > tenant A's API key resolves to A's owner only, never to a B user",
      "apps/web/test/cc13/negative/key-scopes.integration-test.ts > an expired API key is rejected",
    ],
    none: {
      orgKeyScopesAndRevocation: "no verifier for tw_org_api_key (scopes, revokedAt) on main; only the table exists",
    },
  },
  planLimits: { none: "plan model not on main" },
  rrPools: {
    probes: [
      "apps/web/test/cc13/negative/rr-pools.integration-test.ts > refuses to assign tenant B's user as a host of A's RR event type",
    ],
    defects: {
      "CC13-D1": "loadUsers does not filter hosts to team members; a stray non-member Host row is selectable",
    },
  },
} as const;
