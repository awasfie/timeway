-- WC-TW-12b (expand): customer custom hostnames (one per Timeway org).
-- Additive only: one new enum, one new table, indexes, FK, forced RLS.
-- Not applied to the live timeway DB by this PR (migration = Gosi's effect step, backup <= 24 h first).

-- CreateEnum
CREATE TYPE "public"."TwCustomHostnameStatus" AS ENUM ('pending_dns', 'active', 'failed');

-- CreateTable
CREATE TABLE "public"."tw_custom_hostname" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "hostname" TEXT NOT NULL,
    "status" "public"."TwCustomHostnameStatus" NOT NULL DEFAULT 'pending_dns',
    "sslStatus" TEXT NOT NULL DEFAULT 'none',
    "lastError" TEXT,
    "cnameVerifiedAt" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tw_custom_hostname_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tw_custom_hostname_orgId_key" ON "public"."tw_custom_hostname"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "tw_custom_hostname_hostname_key" ON "public"."tw_custom_hostname"("hostname");

-- CreateIndex
CREATE INDEX "tw_custom_hostname_status_createdAt_idx" ON "public"."tw_custom_hostname"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."tw_custom_hostname" ADD CONSTRAINT "tw_custom_hostname_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."tw_organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security: same fail-closed contract as the TW-T9 tables.
-- The approval endpoint and the cleanup job read across orgs under app.tw_platform = 'on'.
ALTER TABLE "public"."tw_custom_hostname" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."tw_custom_hostname" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tw_custom_hostname_isolation" ON "public"."tw_custom_hostname"
  USING (
    current_setting('app.tw_platform', true) = 'on'
    OR "orgId"::text = current_setting('app.tw_org_id', true)
  )
  WITH CHECK (
    current_setting('app.tw_platform', true) = 'on'
    OR "orgId"::text = current_setting('app.tw_org_id', true)
  );
