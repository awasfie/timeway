-- TW-T12 (Bible Q-5 / TW-23): per-org entitlement override. Additive only (expand step):
-- one new table, no upstream table altered, no backfill. An org with no row gets its plan's
-- catalog entitlements (packages/features/tw-plans). RLS is FORCED, same fail-closed policy
-- as the TW-T9 tables.

-- CreateTable
CREATE TABLE "public"."tw_org_entitlement_override" (
    "id" UUID NOT NULL,
    "orgId" UUID NOT NULL,
    "seats" INTEGER,
    "overrides" JSONB,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tw_org_entitlement_override_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tw_org_entitlement_override_orgId_key" ON "public"."tw_org_entitlement_override"("orgId");

-- AddForeignKey
ALTER TABLE "public"."tw_org_entitlement_override" ADD CONSTRAINT "tw_org_entitlement_override_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "public"."tw_organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "public"."tw_org_entitlement_override" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."tw_org_entitlement_override" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tw_org_entitlement_override_isolation" ON "public"."tw_org_entitlement_override"
  USING (
    current_setting('app.tw_platform', true) = 'on'
    OR "orgId"::text = current_setting('app.tw_org_id', true)
  )
  WITH CHECK (
    current_setting('app.tw_platform', true) = 'on'
    OR "orgId"::text = current_setting('app.tw_org_id', true)
  );
