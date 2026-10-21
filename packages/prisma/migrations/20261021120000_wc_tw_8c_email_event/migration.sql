-- WC-TW-8c (expand only): SendGrid Event Webhook ledger for invite bounce / complaint rates (WC.2.5).
-- One new enum, one new table, two plain indexes. No existing table touched, no backfill.
-- Recipient domain only (no address). No tenant column, so no RLS policy: rows are written by the
-- webhook route and read by scripts/email-deliverability.ts only.
-- Not applied to the live timeway DB by this PR (migration = Gosi's effect step, backup <= 24 h first).

-- CreateEnum
CREATE TYPE "public"."TwEmailEventType" AS ENUM ('processed', 'delivered', 'bounce', 'dropped', 'deferred', 'spamreport', 'unsubscribe');

-- CreateTable
CREATE TABLE "public"."tw_email_event" (
    "id" UUID NOT NULL,
    "sgEventId" TEXT NOT NULL,
    "sgMessageId" TEXT,
    "event" "public"."TwEmailEventType" NOT NULL,
    "bookingUid" TEXT,
    "recipientDomain" TEXT,
    "reason" VARCHAR(500),
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tw_email_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tw_email_event_sgEventId_key" ON "public"."tw_email_event"("sgEventId");

-- CreateIndex
CREATE INDEX "tw_email_event_occurredAt_event_idx" ON "public"."tw_email_event"("occurredAt", "event");

-- CreateIndex
CREATE INDEX "tw_email_event_bookingUid_idx" ON "public"."tw_email_event"("bookingUid");
