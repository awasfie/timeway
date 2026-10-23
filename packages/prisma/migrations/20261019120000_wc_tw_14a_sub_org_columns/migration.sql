-- WC-TW-14a (expand, decision E2): sub-org / branding / billing / sandbox columns on
-- tw_organization and `managed` on tw_organization_member.
-- Additive only: one new enum, nullable FK column, NOT NULL columns with constant
-- defaults (metadata-only on PG >= 11, no table rewrite), one plain index.
-- No unique change, no backfill, RLS policies unchanged.
-- Not applied to the live timeway DB by this PR (migration = Gosi's effect step, backup <= 24 h first).

-- CreateEnum
CREATE TYPE "public"."TwBillingAttribution" AS ENUM ('self', 'parent');

-- AlterTable
ALTER TABLE "public"."tw_organization" ADD COLUMN "parentOrgId" UUID;
ALTER TABLE "public"."tw_organization" ADD COLUMN "hideBranding" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "public"."tw_organization" ADD COLUMN "billingAttribution" "public"."TwBillingAttribution" NOT NULL DEFAULT 'self';
ALTER TABLE "public"."tw_organization" ADD COLUMN "isSandbox" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "public"."tw_organization_member" ADD COLUMN "managed" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "tw_organization_parentOrgId_idx" ON "public"."tw_organization"("parentOrgId");

-- AddForeignKey
ALTER TABLE "public"."tw_organization" ADD CONSTRAINT "tw_organization_parentOrgId_fkey" FOREIGN KEY ("parentOrgId") REFERENCES "public"."tw_organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
