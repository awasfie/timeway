-- TW-T9 slice 1 (Bible v12.3 PART TW / Q2-B): Timeway Organizations.
-- Additive only (expand step): three new tables, three new enums.
-- No upstream table is altered. RLS is FORCED on every new table.

-- CreateEnum
CREATE TYPE "public"."OrganizationStatus" AS ENUM ('active', 'suspended', 'closed');

-- CreateEnum
CREATE TYPE "public"."OrganizationIdentityMode" AS ENUM ('local', 'passport');

-- CreateEnum
CREATE TYPE "public"."OrganizationMemberRole" AS ENUM ('owner', 'admin', 'member');

-- CreateTable
CREATE TABLE "public"."tw_organization" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "brand" JSONB,
    "planCode" TEXT,
    "status" "public"."OrganizationStatus" NOT NULL DEFAULT 'active',
    "identityMode" "public"."OrganizationIdentityMode" NOT NULL DEFAULT 'local',
    "externalRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tw_organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tw_organization_member" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "userId" INTEGER NOT NULL,
    "role" "public"."OrganizationMemberRole" NOT NULL DEFAULT 'member',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tw_organization_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."tw_org_api_key" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "prefix" TEXT NOT NULL,
    "hashedKey" TEXT NOT NULL,
    "scopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "tw_org_api_key_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tw_organization_slug_key" ON "public"."tw_organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tw_organization_externalRef_key" ON "public"."tw_organization"("externalRef");

-- CreateIndex
CREATE INDEX "tw_organization_member_userId_idx" ON "public"."tw_organization_member"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "tw_organization_member_orgId_userId_key" ON "public"."tw_organization_member"("orgId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "tw_org_api_key_prefix_key" ON "public"."tw_org_api_key"("prefix");

-- CreateIndex
CREATE INDEX "tw_org_api_key_orgId_idx" ON "public"."tw_org_api_key"("orgId");

-- AddForeignKey
ALTER TABLE "public"."tw_organization_member" ADD CONSTRAINT "tw_organization_member_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."tw_organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tw_organization_member" ADD CONSTRAINT "tw_organization_member_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."tw_org_api_key" ADD CONSTRAINT "tw_org_api_key_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."tw_organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security (fail-closed, AL-11 philosophy; SalesOS/Passport pattern).
-- A row is visible only when the transaction set app.tw_org_id to its org,
-- or when trusted platform code set app.tw_platform = 'on' (provisioning,
-- TW-T10). With neither set, every query returns zero rows.
ALTER TABLE "public"."tw_organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."tw_organization" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tw_organization_isolation" ON "public"."tw_organization"
  USING (
    current_setting('app.tw_platform', true) = 'on'
    OR "id"::text = current_setting('app.tw_org_id', true)
  )
  WITH CHECK (
    current_setting('app.tw_platform', true) = 'on'
    OR "id"::text = current_setting('app.tw_org_id', true)
  );

ALTER TABLE "public"."tw_organization_member" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."tw_organization_member" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tw_organization_member_isolation" ON "public"."tw_organization_member"
  USING (
    current_setting('app.tw_platform', true) = 'on'
    OR "orgId"::text = current_setting('app.tw_org_id', true)
  )
  WITH CHECK (
    current_setting('app.tw_platform', true) = 'on'
    OR "orgId"::text = current_setting('app.tw_org_id', true)
  );

ALTER TABLE "public"."tw_org_api_key" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."tw_org_api_key" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tw_org_api_key_isolation" ON "public"."tw_org_api_key"
  USING (
    current_setting('app.tw_platform', true) = 'on'
    OR "orgId"::text = current_setting('app.tw_org_id', true)
  )
  WITH CHECK (
    current_setting('app.tw_platform', true) = 'on'
    OR "orgId"::text = current_setting('app.tw_org_id', true)
  );
