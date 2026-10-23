-- TW-WF-1: additive enum value for 24h/1h booking reminders (dedupe row per booking + window in ReminderMail.elapsedMinutes)
ALTER TYPE "ReminderType" ADD VALUE IF NOT EXISTS 'BOOKING_REMINDER';
