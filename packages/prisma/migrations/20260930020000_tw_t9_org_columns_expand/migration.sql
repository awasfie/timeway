-- TW-T9 slice 3 (expand): nullable Timeway org id on the five org-scoped tables.
-- Additive only: nullable column, no default, no rewrite, no FK yet (the FK and
-- NOT NULL land in the contract slice after the backfill effect step).
-- Named twOrgId because upstream already has Int "organizationId" (Team) on users.
-- Not applied to the live timeway DB by this PR (migration = effect step).

ALTER TABLE "users"      ADD COLUMN "twOrgId" UUID;
ALTER TABLE "EventType"  ADD COLUMN "twOrgId" UUID;
ALTER TABLE "Booking"    ADD COLUMN "twOrgId" UUID;
ALTER TABLE "Schedule"   ADD COLUMN "twOrgId" UUID;
ALTER TABLE "Credential" ADD COLUMN "twOrgId" UUID;

CREATE INDEX "users_twOrgId_idx"      ON "users"("twOrgId");
CREATE INDEX "EventType_twOrgId_idx"  ON "EventType"("twOrgId");
CREATE INDEX "Booking_twOrgId_idx"    ON "Booking"("twOrgId");
CREATE INDEX "Schedule_twOrgId_idx"   ON "Schedule"("twOrgId");
CREATE INDEX "Credential_twOrgId_idx" ON "Credential"("twOrgId");
