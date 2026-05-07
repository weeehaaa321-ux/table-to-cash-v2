-- Hotel Phase 3 additions: guest stay token + OTA iCal sync.
-- Purely additive; no destructive changes.

ALTER TABLE "Hotel" ADD COLUMN "icalSyncs" JSONB;

ALTER TABLE "Reservation" ADD COLUMN "stayToken" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "externalUid" TEXT;

CREATE UNIQUE INDEX "Reservation_stayToken_key" ON "Reservation"("stayToken");
CREATE INDEX "Reservation_externalUid_idx" ON "Reservation"("externalUid");
