-- WC-TW-9b (expand): activation ledger tw_activation_event.
-- Additive only: one new enum, one new table, one unique index, one FK, RLS on the new table.
-- No existing table or column is altered; no backfill (decision 5: history before the
-- ledger is not reconstructed).
-- Not applied to the live timeway DB by this PR (migration = Gosi's effect step, backup <= 24 h first).

-- CreateEnum
CREATE TYPE "public"."TwActivationKind" AS ENUM ('calendar_connected', 'event_type_published', 'first_external_booking');

-- CreateTable
CREATE TABLE "public"."tw_activation_event" (
    "id" UUID NOT NULL,
    "twOrgId" UUID NOT NULL,
    "kind" "public"."TwActivationKind" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "refId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tw_activation_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tw_activation_event_twOrgId_kind_key" ON "public"."tw_activation_event"("twOrgId", "kind");

-- AddForeignKey
ALTER TABLE "public"."tw_activation_event" ADD CONSTRAINT "tw_activation_event_twOrgId_fkey" FOREIGN KEY ("twOrgId") REFERENCES "public"."tw_organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security: same fail-closed policy as the TW-T9 tables (20260928020000).
ALTER TABLE "public"."tw_activation_event" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."tw_activation_event" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tw_activation_event_isolation" ON "public"."tw_activation_event"
  USING (
    current_setting('app.tw_platform', true) = 'on'
    OR "twOrgId"::text = current_setting('app.tw_org_id', true)
  )
  WITH CHECK (
    current_setting('app.tw_platform', true) = 'on'
    OR "twOrgId"::text = current_setting('app.tw_org_id', true)
  );
