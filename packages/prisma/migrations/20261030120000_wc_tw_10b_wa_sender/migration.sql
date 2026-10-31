-- WC-TW-10b (expand): per-org WhatsApp reminder sender (shared number stays the default).
-- Additive only: one new enum and four NULLABLE columns on tw_organization. No default, no backfill,
-- no rewrite of existing rows; NULL mode reads as "shared". Existing RLS on tw_organization covers the columns.
-- Not applied to the live timeway DB by this PR (migration = Gosi's effect step, backup <= 24 h first).

-- CreateEnum
CREATE TYPE "public"."TwWaSenderMode" AS ENUM ('shared', 'own');

-- AlterTable
ALTER TABLE "public"."tw_organization"
  ADD COLUMN "waSenderMode" "public"."TwWaSenderMode",
  ADD COLUMN "waSenderPhoneNumberId" TEXT,
  ADD COLUMN "waSenderDisplayNumber" TEXT,
  ADD COLUMN "waSenderVerifiedAt" TIMESTAMP(3);
