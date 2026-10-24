-- WC-TW-12b (expand): Cloudflare for SaaS custom hostnames, one per organization (Team). D5.
-- Additive only: one new table, no existing table altered, no backfill.
-- Not applied to the live timeway DB by this PR (migration = Gosi's effect step, backup <= 24 h first).

-- CreateTable
CREATE TABLE "public"."tw_custom_hostname" (
    "id" UUID NOT NULL,
    "organizationId" INTEGER NOT NULL,
    "hostname" TEXT NOT NULL,
    "cfHostnameId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sslStatus" TEXT,
    "verificationErrors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastCheckedAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),

    CONSTRAINT "tw_custom_hostname_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tw_custom_hostname_organizationId_key" ON "public"."tw_custom_hostname"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "tw_custom_hostname_hostname_key" ON "public"."tw_custom_hostname"("hostname");

-- CreateIndex
CREATE UNIQUE INDEX "tw_custom_hostname_cfHostnameId_key" ON "public"."tw_custom_hostname"("cfHostnameId");

-- CreateIndex
CREATE INDEX "tw_custom_hostname_status_createdAt_idx" ON "public"."tw_custom_hostname"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."tw_custom_hostname" ADD CONSTRAINT "tw_custom_hostname_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "public"."Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
