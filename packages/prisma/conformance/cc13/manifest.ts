/**
 * CC-13 (extended) coverage manifest — hand-kept (WC-TW-7a).
 *
 * One entry per model in models.generated.json; each entry names, per surface, either:
 *   - a probe id "<repo-relative path>.integration-test.ts > <test name>" (or an API v2 e2e spec),
 *   - { none: "<why this surface cannot reach the model>" }, or
 *   - { pending: "WC-TW-7c" | "WC-TW-7d" } while the probe card is open.
 *
 * coverage.test.ts fails on a missing/extra model, a missing surface, an unknown pending card,
 * or a probe id whose file or test name does not exist. Pending is reported, never counted as covered.
 */

export const SURFACES = ["pages", "trpc", "apiV2", "apiKey", "webhook", "publicSlug", "job"] as const;
export type Surface = (typeof SURFACES)[number];

export const PENDING_CARDS = ["WC-TW-7c", "WC-TW-7d"] as const;
export type PendingCard = (typeof PENDING_CARDS)[number];

export type ProbeId = `${string} > ${string}`;
export type SurfaceCoverage = ProbeId | { none: string } | { pending: PendingCard };
export type ModelCoverage = Record<Surface, SurfaceCoverage>;

/** Card ownership of surfaces not yet probed. WC-TW-7b surfaces (pages, trpc, publicSlug) are all resolved below. */
const OWNER: Record<"apiV2" | "apiKey" | "webhook" | "job", PendingCard> = {
  apiV2: "WC-TW-7c",
  apiKey: "WC-TW-7c",
  webhook: "WC-TW-7c",
  job: "WC-TW-7c",
};

const pending = (
  resolved: Pick<ModelCoverage, "pages" | "trpc" | "publicSlug"> & Partial<ModelCoverage>
): ModelCoverage => {
  const entry = { ...resolved } as ModelCoverage;
  for (const s of ["apiV2", "apiKey", "webhook", "job"] as const)
    entry[s] = resolved[s] ?? { pending: OWNER[s] };
  return entry;
};

export const manifest: Record<string, ModelCoverage> = {
  AccessCode: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads AccessCode (accessor scan, 2026-11-07)",
    },
    trpc: {
      none: "no router under packages/trpc/server/routers/{viewer,loggedInViewer,publicViewer} reads AccessCode (import-graph and prisma-accessor scan, 2026-11-07)",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read AccessCode (accessor scan, 2026-11-07)",
    },
  }),
  ActivationEvent: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads ActivationEvent (accessor scan, 2026-11-07)",
    },
    trpc: {
      none: "no router under packages/trpc/server/routers/{viewer,loggedInViewer,publicViewer} reads ActivationEvent (import-graph and prisma-accessor scan, 2026-11-07)",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read ActivationEvent (accessor scan, 2026-11-07)",
    },
  }),
  Agent: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads Agent (accessor scan, 2026-11-07)",
    },
    trpc: {
      none: "no router under packages/trpc/server/routers/{viewer,loggedInViewer,publicViewer} reads Agent (import-graph and prisma-accessor scan, 2026-11-07)",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read Agent (accessor scan, 2026-11-07)",
    },
  }),
  ApiKey: pending({
    pages: {
      none: "settings/developer/api-keys/page.tsx lists the session user's own keys; it takes no id param, so there is no by-id loader to probe",
    },
    trpc: "apps/web/test/cc13/trpc.integration-test.ts > viewer.apiKeys.list: B's key list holds none of A's keys",
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read ApiKey (accessor scan, 2026-11-07)",
    },
  }),
  Attribute: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads Attribute (accessor scan, 2026-11-07)",
    },
    trpc: {
      none: "no router under packages/trpc/server/routers/{viewer,loggedInViewer,publicViewer} reads Attribute (import-graph and prisma-accessor scan, 2026-11-07)",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read Attribute (accessor scan, 2026-11-07)",
    },
  }),
  Avatar: pending({
    pages: {
      none: "served by app/api/avatar/[uuid]/route.ts, an API route, not a page loader (public by uuid)",
    },
    trpc: {
      none: "no router under packages/trpc/server/routers/{viewer,loggedInViewer,publicViewer} reads Avatar (import-graph and prisma-accessor scan, 2026-11-07)",
    },
    publicSlug: {
      none: "unprobed gap, follow-up card WC-TW-7b-5: api/avatar/[uuid] is public by uuid; no probe yet",
    },
  }),
  Booking: pending({
    pages:
      "apps/web/test/cc13/pages.integration-test.ts > B (signed in) gets canViewHiddenData false and no hidden response field of A's booking",
    trpc: "apps/web/test/cc13/trpc.integration-test.ts > viewer.bookings.getBookingDetails: B gets nothing of A's booking",
    publicSlug:
      "apps/web/test/cc13/public-slug.integration-test.ts > createBooking with A's eventTypeId under B-org hints stamps A's twOrgId, never B's",
  }),
  BookingDenormalized: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads BookingDenormalized (accessor scan, 2026-11-07)",
    },
    trpc: {
      none: "no router under packages/trpc/server/routers/{viewer,loggedInViewer,publicViewer} reads BookingDenormalized (import-graph and prisma-accessor scan, 2026-11-07)",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read BookingDenormalized (accessor scan, 2026-11-07)",
    },
  }),
  BookingReport: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads BookingReport (accessor scan, 2026-11-07)",
    },
    trpc: {
      none: "unprobed gap, follow-up card WC-TW-7b-5: viewer/bookings/reportBooking.handler.ts reads it; no probe yet",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read BookingReport (accessor scan, 2026-11-07)",
    },
  }),
  BookingTimeStatus: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads BookingTimeStatus (accessor scan, 2026-11-07)",
    },
    trpc: {
      none: "no router under packages/trpc/server/routers/{viewer,loggedInViewer,publicViewer} reads BookingTimeStatus (import-graph and prisma-accessor scan, 2026-11-07)",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read BookingTimeStatus (accessor scan, 2026-11-07)",
    },
  }),
  BookingTimeStatusDenormalized: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads BookingTimeStatusDenormalized (accessor scan, 2026-11-07)",
    },
    trpc: {
      none: "no router under packages/trpc/server/routers/{viewer,loggedInViewer,publicViewer} reads BookingTimeStatusDenormalized (import-graph and prisma-accessor scan, 2026-11-07)",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read BookingTimeStatusDenormalized (accessor scan, 2026-11-07)",
    },
  }),
  CalAiPhoneNumber: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads CalAiPhoneNumber (accessor scan, 2026-11-07)",
    },
    trpc: {
      none: "no router under packages/trpc/server/routers/{viewer,loggedInViewer,publicViewer} reads CalAiPhoneNumber (import-graph and prisma-accessor scan, 2026-11-07)",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read CalAiPhoneNumber (accessor scan, 2026-11-07)",
    },
  }),
  Credential: pending({
    pages: {
      none: "unprobed gap, follow-up card WC-TW-7b-5: lib/apps/installation/[[...step]]/getServerSideProps.ts reads credentials; no probe yet",
    },
    trpc: "apps/web/test/cc13/trpc.integration-test.ts > viewer.credentials.delete: B cannot delete A's credential",
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read Credential (accessor scan, 2026-11-07)",
    },
  }),
  CreditBalance: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads CreditBalance (accessor scan, 2026-11-07)",
    },
    trpc: {
      none: "no router under packages/trpc/server/routers/{viewer,loggedInViewer,publicViewer} reads CreditBalance (import-graph and prisma-accessor scan, 2026-11-07)",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read CreditBalance (accessor scan, 2026-11-07)",
    },
  }),
  DSyncData: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads DSyncData (accessor scan, 2026-11-07)",
    },
    trpc: {
      none: "no router under packages/trpc/server/routers/{viewer,loggedInViewer,publicViewer} reads DSyncData (import-graph and prisma-accessor scan, 2026-11-07)",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read DSyncData (accessor scan, 2026-11-07)",
    },
  }),
  DSyncTeamGroupMapping: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads DSyncTeamGroupMapping (accessor scan, 2026-11-07)",
    },
    trpc: {
      none: "no router under packages/trpc/server/routers/{viewer,loggedInViewer,publicViewer} reads DSyncTeamGroupMapping (import-graph and prisma-accessor scan, 2026-11-07)",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read DSyncTeamGroupMapping (accessor scan, 2026-11-07)",
    },
  }),
  DelegationCredential: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads DelegationCredential (accessor scan, 2026-11-07)",
    },
    trpc: {
      none: "no router under packages/trpc/server/routers/{viewer,loggedInViewer,publicViewer} reads DelegationCredential (import-graph and prisma-accessor scan, 2026-11-07)",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read DelegationCredential (accessor scan, 2026-11-07)",
    },
  }),
  EventType: pending({
    pages:
      "apps/web/test/cc13/pages.integration-test.ts > B cannot open A's event type (viewer.eventTypes.get denies before the all-true permissions)",
    trpc: "apps/web/test/cc13/trpc.integration-test.ts > viewer.eventTypes.get: B cannot read A's event type",
    publicSlug:
      "apps/web/test/cc13/public-slug.integration-test.ts > hidden personal event: anonymous and B see the same public props, no A emails or booking uids",
  }),
  FilterSegment: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads FilterSegment (accessor scan, 2026-11-07)",
    },
    trpc: {
      none: "unprobed gap, follow-up card WC-TW-7b-5: viewer/filterSegments/{list,create,update,delete}.handler.ts read it (keyed by ctx.user.id); no probe yet",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read FilterSegment (accessor scan, 2026-11-07)",
    },
  }),
  InstantMeetingToken: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads InstantMeetingToken (accessor scan, 2026-11-07)",
    },
    trpc: {
      none: "unprobed gap, follow-up card WC-TW-7b-5: loggedInViewer/connectAndJoin.handler.ts reads it; no probe yet",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read InstantMeetingToken (accessor scan, 2026-11-07)",
    },
  }),
  IntegrationAttributeSync: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads IntegrationAttributeSync (accessor scan, 2026-11-07)",
    },
    trpc: {
      none: "no router under packages/trpc/server/routers/{viewer,loggedInViewer,publicViewer} reads IntegrationAttributeSync (import-graph and prisma-accessor scan, 2026-11-07)",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read IntegrationAttributeSync (accessor scan, 2026-11-07)",
    },
  }),
  InternalNotePreset: pending({
    pages:
      "apps/web/test/cc13/pages.integration-test.ts > B (signed in) gets canViewHiddenData false and no hidden response field of A's booking",
    trpc: {
      none: "no router under packages/trpc/server/routers/{viewer,loggedInViewer,publicViewer} reads InternalNotePreset (import-graph and prisma-accessor scan, 2026-11-07)",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read InternalNotePreset (accessor scan, 2026-11-07)",
    },
  }),
  Membership: pending({
    pages:
      "apps/web/test/cc13/pages.integration-test.ts > B cannot open A's team webhook (inline membership check)",
    trpc: "apps/web/test/cc13/trpc.integration-test.ts > viewer.eventTypes.getEventTypesFromGroup: B cannot list A's team event types",
    publicSlug:
      "apps/web/test/cc13/public-slug.integration-test.ts > public team page: hosts expose name/username only, never emails",
  }),
  MonthlyProration: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads MonthlyProration (accessor scan, 2026-11-07)",
    },
    trpc: {
      none: "no router under packages/trpc/server/routers/{viewer,loggedInViewer,publicViewer} reads MonthlyProration (import-graph and prisma-accessor scan, 2026-11-07)",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read MonthlyProration (accessor scan, 2026-11-07)",
    },
  }),
  OrgApiKey: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads OrgApiKey (accessor scan, 2026-11-07)",
    },
    trpc: {
      none: "no router under packages/trpc/server/routers/{viewer,loggedInViewer,publicViewer} reads OrgApiKey (import-graph and prisma-accessor scan, 2026-11-07)",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read OrgApiKey (accessor scan, 2026-11-07)",
    },
  }),
  Organization: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads Organization (accessor scan, 2026-11-07)",
    },
    trpc: {
      none: "no router under packages/trpc/server/routers/{viewer,loggedInViewer,publicViewer} reads Organization (import-graph and prisma-accessor scan, 2026-11-07)",
    },
    publicSlug: {
      none: "unprobed gap, follow-up card WC-TW-7b-5: team/[slug]/orgLandingPage.tsx reads tw_organization via OrgLandingRepository; org landing is not covered by the slug probes",
    },
  }),
  OrganizationBilling: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads OrganizationBilling (accessor scan, 2026-11-07)",
    },
    trpc: {
      none: "no router under packages/trpc/server/routers/{viewer,loggedInViewer,publicViewer} reads OrganizationBilling (import-graph and prisma-accessor scan, 2026-11-07)",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read OrganizationBilling (accessor scan, 2026-11-07)",
    },
  }),
  OrganizationMember: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads OrganizationMember (accessor scan, 2026-11-07)",
    },
    trpc: "apps/web/test/cc13/trpc.integration-test.ts > viewer.organizations.customDomain.add and remove: B cannot change A's org custom hostname",
    publicSlug: {
      none: "unprobed gap, follow-up card WC-TW-7b-5: org landing and custom-host resolver read it (CustomHostnameRepository); not covered by the slug probes",
    },
  }),
  OrganizationOnboarding: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads OrganizationOnboarding (accessor scan, 2026-11-07)",
    },
    trpc: {
      none: "no router under packages/trpc/server/routers/{viewer,loggedInViewer,publicViewer} reads OrganizationOnboarding (import-graph and prisma-accessor scan, 2026-11-07)",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read OrganizationOnboarding (accessor scan, 2026-11-07)",
    },
  }),
  OrganizationSettings: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads OrganizationSettings (accessor scan, 2026-11-07)",
    },
    trpc: "apps/web/test/cc13/trpc.integration-test.ts > viewer.eventTypesHeavy.create: B cannot create a team event type on A's team",
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read OrganizationSettings (accessor scan, 2026-11-07)",
    },
  }),
  PlatformOAuthClient: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads PlatformOAuthClient (accessor scan, 2026-11-07)",
    },
    trpc: {
      none: "no router under packages/trpc/server/routers/{viewer,loggedInViewer,publicViewer} reads PlatformOAuthClient (import-graph and prisma-accessor scan, 2026-11-07)",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read PlatformOAuthClient (accessor scan, 2026-11-07)",
    },
  }),
  Profile: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads Profile (accessor scan, 2026-11-07)",
    },
    trpc: "apps/web/test/cc13/trpc.integration-test.ts > viewer.eventTypes.getEventTypesFromGroup: B cannot list A's team event types",
    publicSlug:
      "apps/web/test/cc13/public-slug.integration-test.ts > org context: A's org-member usernames do not resolve on the top-level path",
  }),
  Role: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads Role (accessor scan, 2026-11-07)",
    },
    trpc: {
      none: "no router under packages/trpc/server/routers/{viewer,loggedInViewer,publicViewer} reads Role (import-graph and prisma-accessor scan, 2026-11-07)",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read Role (accessor scan, 2026-11-07)",
    },
  }),
  Schedule: pending({
    pages: "apps/web/test/cc13/pages.integration-test.ts > B cannot open A's schedule",
    trpc: "apps/web/test/cc13/trpc.integration-test.ts > viewer.availability.schedule.get: B cannot read A's schedule",
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read Schedule (accessor scan, 2026-11-07)",
    },
  }),
  SeatChangeLog: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads SeatChangeLog (accessor scan, 2026-11-07)",
    },
    trpc: {
      none: "no router under packages/trpc/server/routers/{viewer,loggedInViewer,publicViewer} reads SeatChangeLog (import-graph and prisma-accessor scan, 2026-11-07)",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read SeatChangeLog (accessor scan, 2026-11-07)",
    },
  }),
  Team: pending({
    pages:
      "apps/web/test/cc13/pages.integration-test.ts > B cannot open A's team webhook (inline membership check)",
    trpc: "apps/web/test/cc13/trpc.integration-test.ts > viewer.eventTypes.getEventTypesFromGroup: B cannot list A's team event types",
    publicSlug:
      "apps/web/test/cc13/public-slug.integration-test.ts > private team: anonymous and B get no member names, usernames or emails",
  }),
  TeamBilling: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads TeamBilling (accessor scan, 2026-11-07)",
    },
    trpc: {
      none: "no router under packages/trpc/server/routers/{viewer,loggedInViewer,publicViewer} reads TeamBilling (import-graph and prisma-accessor scan, 2026-11-07)",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read TeamBilling (accessor scan, 2026-11-07)",
    },
  }),
  TeamFeatures: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads TeamFeatures (accessor scan, 2026-11-07)",
    },
    trpc: {
      none: "only viewer/admin/getTeamsForFeature.handler.ts reads it, an instance-admin procedure; a tenant session is rejected by the admin middleware",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read TeamFeatures (accessor scan, 2026-11-07)",
    },
  }),
  TwCustomHostname: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads TwCustomHostname (accessor scan, 2026-11-07)",
    },
    trpc: "apps/web/test/cc13/trpc.integration-test.ts > viewer.organizations.customDomain.get: B cannot read A's org custom hostname",
    publicSlug: {
      none: "unprobed gap, follow-up card WC-TW-7b-5: CustomHostResolverRepository resolves a host to an org outside /[user]/[type] and /team/[slug]/[type]; not covered",
    },
  }),
  User: pending({
    pages: "apps/web/test/cc13/pages.integration-test.ts > B cannot open A's personal (userId) webhook",
    trpc: "apps/web/test/cc13/trpc.integration-test.ts > viewer.bookings.get: B's booking list contains none of A's bookings",
    publicSlug:
      "apps/web/test/cc13/public-slug.integration-test.ts > hidden personal event: A's profile listing omits it for anonymous and B",
  }),
  VerificationToken: pending({
    pages: {
      none: "lib/signup/getServerSideProps.tsx and lib/pages/auth/verify-email.ts look up by secret token, not by tenant id; no tenant-keyed read",
    },
    trpc: {
      none: "no router under packages/trpc/server/routers/{viewer,loggedInViewer,publicViewer} reads VerificationToken (import-graph and prisma-accessor scan, 2026-11-07)",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read VerificationToken (accessor scan, 2026-11-07)",
    },
  }),
  VerifiedEmail: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads VerifiedEmail (accessor scan, 2026-11-07)",
    },
    trpc: {
      none: "no router under packages/trpc/server/routers/{viewer,loggedInViewer,publicViewer} reads VerifiedEmail (import-graph and prisma-accessor scan, 2026-11-07)",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read VerifiedEmail (accessor scan, 2026-11-07)",
    },
  }),
  VerifiedNumber: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads VerifiedNumber (accessor scan, 2026-11-07)",
    },
    trpc: {
      none: "no router under packages/trpc/server/routers/{viewer,loggedInViewer,publicViewer} reads VerifiedNumber (import-graph and prisma-accessor scan, 2026-11-07)",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read VerifiedNumber (accessor scan, 2026-11-07)",
    },
  }),
  Watchlist: pending({
    pages: {
      none: "read only inside the signup handler (app/api/auth/signup), an API route, not a page loader",
    },
    trpc: {
      none: "only viewer/admin/lockUserAccount.handler.ts reads it, an instance-admin procedure; a tenant session is rejected by the admin middleware",
    },
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read Watchlist (accessor scan, 2026-11-07)",
    },
  }),
  Webhook: pending({
    pages:
      "apps/web/test/cc13/pages.integration-test.ts > B cannot open A's team webhook (inline membership check)",
    trpc: "apps/web/test/cc13/trpc.integration-test.ts > viewer.webhook.get: B cannot read A's webhook",
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read Webhook (accessor scan, 2026-11-07)",
    },
  }),
  WrongAssignmentReport: pending({
    pages: {
      none: "no page loader under apps/web/{app,modules,lib,server/lib,pages} reads WrongAssignmentReport (accessor scan, 2026-11-07)",
    },
    trpc: "apps/web/test/cc13/trpc.integration-test.ts > viewer.bookings.getWrongAssignmentReports (createTeamPbacProcedure): B gets FORBIDDEN on A's team",
    publicSlug: {
      none: "/[user]/[type] and /team/[slug]/[type] loaders do not read WrongAssignmentReport (accessor scan, 2026-11-07)",
    },
  }),
};

/** WC-TW-7d negative-test ids and recorded gaps (kept apart from the model x surface matrix). */
export const negative = {
  invitations: {
    probes: [
      "apps/web/test/cc13/negative/invitations.integration-test.ts > an invite token for tenant B grants nothing in tenant A",
      "apps/web/test/cc13/negative/invitations.integration-test.ts > an invite token minted for A's invitee creates only a MEMBER membership in A, never an elevated role",
      "apps/web/test/cc13/negative/invitations.integration-test.ts > an existing member's invite cannot raise their role (pending ADMIN stays what the inviter set)",
      "apps/web/test/cc13/negative/invitations.integration-test.ts > CC13-D2 fixed: an invite token minted for one email cannot be accepted by a different email",
    ],
    defects: {},
    none: { bAdminInvitesIntoA: "no invite-creation endpoint (team invite router) on main" },
  },
  keyScopes: {
    probes: [
      "apps/web/test/cc13/negative/key-scopes.integration-test.ts > tenant A's API key resolves to A's owner only, never to a B user",
      "apps/web/test/cc13/negative/key-scopes.integration-test.ts > an expired API key is rejected",
    ],
    none: {
      orgKeyScopesAndRevocation:
        "no verifier for tw_org_api_key (scopes, revokedAt) on main; only the table exists",
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
