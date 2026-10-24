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

/** webhook surface (WC-TW-7c-4): webhooks hang off User, Team, EventType and PlatformOAuthClient and fire for Booking events; no other model is read or written by a webhook handler or the trigger path. */
const WEBHOOK_NONE = {
  none: "no webhook config handler, v2 webhooks route or trigger path reads or writes this model",
};

/** job surface (WC-TW-7c-5): the cron handlers (sendBookingReminders, bookingReminder, webhookTriggers) read Booking, its User/attendees, EventType hosts and Webhook subscribers; downgradeUsers and scheduleEmailReminders have no handler in this repo. */
const JOBS = "apps/web/test/cc13/jobs.integration-test.ts";
const JOB_NONE = {
  none: "no cron handler (sendBookingReminders, bookingReminder, webhookTriggers) nor downgradeUsers/scheduleEmailReminders reads or writes this model",
};
const JOB_PROBES: Record<string, ProbeId> = {
  Booking: `${JOBS} > sendBookingReminders sends A's reminders only to A's host, hosts and attendees and B's only to B's`,
  EventType: `${JOBS} > bookingReminder (pending confirmation) mails A's organizer and attendee for A's booking and B's for B's`,
  User: `${JOBS} > sendBookingReminders sends A's reminders only to A's host, hosts and attendees and B's only to B's`,
  Webhook: `${JOBS} > webhookTriggers delivers A's scheduled trigger only to A's subscriber, signed with A's secret, and B's only to B's`,
};

const pending = (overrides: Partial<ModelCoverage> = {}): ModelCoverage => {
  const entry = {} as ModelCoverage;
  for (const s of SURFACES) entry[s] = overrides[s] ?? { pending: OWNER[s] };
  return entry;
};

export const manifest: Record<string, ModelCoverage> = {
  AccessCode: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  Agent: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  ApiKey: pending({
    webhook: WEBHOOK_NONE,
    apiKey: "apps/web/test/cc13/api-key.integration-test.ts > B cannot list A's api keys",
  }),
  Attribute: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  Avatar: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  Booking: pending({
    webhook:
      "apps/web/test/cc13/webhook.integration-test.ts > A's booking event is delivered to A's subscribers and never to B's subscriber URLs",
    apiV2: "apps/api/v2/src/platform/cc13-cross-tenant.e2e-spec.ts > B cannot read A's booking references",
    apiKey:
      "apps/api/v2/src/platform/cc13-cross-tenant-api-key.e2e-spec.ts > B's API key lists none of A's bookings, event types or schedules",
  }),
  BookingDenormalized: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  BookingReport: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  BookingTimeStatus: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  BookingTimeStatusDenormalized: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  CalAiPhoneNumber: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  Credential: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  CreditBalance: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  DSyncData: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  DSyncTeamGroupMapping: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  DelegationCredential: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  EventType: pending({
    webhook: "apps/web/test/cc13/webhook.integration-test.ts > B cannot create a webhook on A's event type",
    apiV2: "apps/api/v2/src/platform/cc13-cross-tenant.e2e-spec.ts > B cannot update A's event type",
    apiKey:
      "apps/api/v2/src/platform/cc13-cross-tenant-api-key.e2e-spec.ts > B's API key cannot update or delete A's event type and schedule",
  }),
  FilterSegment: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  InstantMeetingToken: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  IntegrationAttributeSync: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  InternalNotePreset: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  Membership: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  MonthlyProration: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  OrgApiKey: pending({
    webhook: WEBHOOK_NONE,
    apiKey: "apps/web/test/cc13/api-key.integration-test.ts > B's org context cannot read A's org api key",
  }),
  Organization: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  OrganizationBilling: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  OrganizationMember: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  OrganizationOnboarding: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  OrganizationSettings: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  PlatformOAuthClient: pending({
    webhook:
      "apps/api/v2/src/platform/cc13-webhooks.e2e-spec.ts > B cannot list, read, update or delete webhooks of A's oauth client",
    apiKey: API_KEY_NONE,
  }),
  Profile: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  Role: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  Schedule: pending({
    webhook: WEBHOOK_NONE,
    apiV2: "apps/api/v2/src/platform/cc13-cross-tenant.e2e-spec.ts > B cannot update A's schedule",
    apiKey:
      "apps/api/v2/src/platform/cc13-cross-tenant-api-key.e2e-spec.ts > B's API key cannot update or delete A's event type and schedule",
  }),
  SeatChangeLog: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  Team: pending({
    webhook:
      "apps/web/test/cc13/webhook.integration-test.ts > getWebhooks for A's event type returns none of B's webhooks",
    apiKey: API_KEY_NONE,
  }),
  TeamBilling: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  TeamFeatures: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  TwCustomHostname: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  User: pending({
    webhook: "apps/web/test/cc13/webhook.integration-test.ts > B list returns none of A's webhooks",
    apiKey: API_KEY_NONE,
  }),
  VerificationToken: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  VerifiedEmail: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  VerifiedNumber: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  Watchlist: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
  Webhook: pending({
    webhook:
      "apps/web/test/cc13/webhook.integration-test.ts > B cannot delete A's team, user and event-type webhook",
    apiV2: "apps/api/v2/src/platform/cc13-webhooks.e2e-spec.ts > B cannot update A's webhook",
    apiKey: API_KEY_NONE,
  }),
  WrongAssignmentReport: pending({ webhook: WEBHOOK_NONE, apiKey: API_KEY_NONE }),
};

// apiV2 surface (WC-TW-7c-1/2): probed models listed here, special none() reasons next, every other model falls to API_V2_NONE; Webhook keeps its own row.
const API_V2_NONE = { none: "no apps/api/v2 route reads or writes this model" };
const API_V2_PROBES: Record<string, SurfaceCoverage> = {
  Booking: "apps/api/v2/src/platform/cc13-cross-tenant.e2e-spec.ts > B cannot read A's booking references",
  Credential:
    "apps/api/v2/src/platform/cc13-cross-tenant-orgs.e2e-spec.ts > B cannot disconnect A's calendar credential",
  EventType: "apps/api/v2/src/platform/cc13-cross-tenant.e2e-spec.ts > B cannot update A's event type",
  Membership:
    "apps/api/v2/src/platform/cc13-cross-tenant-orgs.e2e-spec.ts > B cannot update A's managed user or membership",
  Organization:
    "apps/api/v2/src/platform/cc13-cross-tenant-orgs.e2e-spec.ts > B cannot update A's OAuth client",
  PlatformOAuthClient:
    "apps/api/v2/src/platform/cc13-cross-tenant-orgs.e2e-spec.ts > B cannot read A's OAuth client",
  Profile:
    "apps/api/v2/src/platform/cc13-cross-tenant-orgs.e2e-spec.ts > B reads only its own profile via /me",
  Schedule: "apps/api/v2/src/platform/cc13-cross-tenant.e2e-spec.ts > B cannot update A's schedule",
  User: "apps/api/v2/src/platform/cc13-cross-tenant-orgs.e2e-spec.ts > B cannot read A's managed user",
  VerifiedEmail:
    "apps/api/v2/src/platform/cc13-cross-tenant-orgs.e2e-spec.ts > B cannot read A's verified email by id",
  VerifiedNumber:
    "apps/api/v2/src/platform/cc13-cross-tenant-orgs.e2e-spec.ts > B cannot read A's verified phone by id",
  ApiKey: {
    none: "/v2/api-keys/refresh acts only on the key presented in the caller's own Authorization header; cross-tenant key use is the apiKey surface (WC-TW-7c-3)",
  },
  OrganizationSettings: {
    none: "read internally by the admin-API guard (fetchOrgAdminApiStatus); no route returns or writes it",
  },
  Team: {
    none: "apps/api/v2 has no team controller; team/org rows are reached only through the org-scoped OAuthClientGuard/RolesGuard, probed under Organization and PlatformOAuthClient",
  },
};
for (const [model, coverage] of Object.entries(manifest)) {
  if (typeof coverage.apiV2 === "object" && "pending" in coverage.apiV2)
    coverage.apiV2 = API_V2_PROBES[model] ?? API_V2_NONE;
}

// job surface (WC-TW-7c-5): applied to every model in one pass so the per-model rows stay untouched.
for (const [model, coverage] of Object.entries(manifest)) {
  coverage.job = JOB_PROBES[model] ?? JOB_NONE;
}
