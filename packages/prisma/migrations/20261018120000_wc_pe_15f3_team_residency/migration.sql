-- WC-PE-15f3 (expand): clinic-tenant residency columns on "Team" (WC-31, uae-cell.md section 7).
-- Additive only: nullable, no default, no backfill, no rewrite.
-- Not applied to the live timeway DB by this PR (migration = Gosi's effect step, backup <= 24 h first).

ALTER TABLE "Team" ADD COLUMN "vertical" TEXT;
ALTER TABLE "Team" ADD COLUMN "handlesPhi" BOOLEAN;
ALTER TABLE "Team" ADD COLUMN "residencyCell" TEXT;
