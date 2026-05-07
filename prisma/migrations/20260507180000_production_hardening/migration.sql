-- Production hardening: schema additions for security, reliability,
-- and bug fixes. All purely additive; no destructive changes.

-- ─── Guest.isPlaceholder ─────────────────────────────────────────
-- Replaces fragile name-suffix regex with an explicit column. iCal
-- pull sets true; CheckInModal flips it false when real details
-- are captured.
ALTER TABLE "Guest" ADD COLUMN "isPlaceholder" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: existing OTA placeholder guests created before this
-- migration. The pattern was "{Source} guest" — match those names
-- so the new flag agrees with the historical regex.
UPDATE "Guest"
SET "isPlaceholder" = true
WHERE "name" LIKE '%.com guest'
   OR "name" = 'Booking.com guest'
   OR "name" = 'Airbnb guest'
   OR "name" = 'Expedia guest'
   OR "name" = 'TripAdvisor guest'
   OR "name" = 'Hostelworld guest'
   OR "name" = 'Vrbo guest'
   OR "name" = 'Agoda guest'
   OR "name" = 'OTA guest';

-- ─── RoomType.icalExportToken ────────────────────────────────────
-- Per-type secret used in the iCal export URL so a leak of one
-- URL only exposes one type's calendar. Generated lazily.
ALTER TABLE "RoomType" ADD COLUMN "icalExportToken" TEXT;
CREATE UNIQUE INDEX "RoomType_icalExportToken_key" ON "RoomType"("icalExportToken");

-- ─── Reservation.icalSourceRoom ──────────────────────────────────
-- "{source}:{roomNumber}" tag identifying which iCal feed pulled
-- this reservation. Lets silent-removal reconciliation scope to a
-- single feed instead of cancelling cross-feed reservations.
ALTER TABLE "Reservation" ADD COLUMN "icalSourceRoom" TEXT;
CREATE INDEX "Reservation_icalSourceRoom_idx" ON "Reservation"("icalSourceRoom");

-- ─── MailLog ─────────────────────────────────────────────────────
CREATE TYPE "MailStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'ABANDONED');

CREATE TABLE "MailLog" (
    "id"            TEXT NOT NULL,
    "hotelId"       TEXT,
    "toAddress"     TEXT NOT NULL,
    "fromAddress"   TEXT NOT NULL,
    "subject"       TEXT NOT NULL,
    "status"        "MailStatus" NOT NULL DEFAULT 'PENDING',
    "attempts"      INTEGER NOT NULL DEFAULT 0,
    "lastError"     TEXT,
    "payload"       JSONB NOT NULL,
    "providerId"    TEXT,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt"        TIMESTAMP(3),
    "lastAttemptAt" TIMESTAMP(3),
    CONSTRAINT "MailLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MailLog_status_createdAt_idx" ON "MailLog"("status", "createdAt");
CREATE INDEX "MailLog_hotelId_createdAt_idx" ON "MailLog"("hotelId", "createdAt");
