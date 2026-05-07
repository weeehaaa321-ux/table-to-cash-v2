-- OTA-native PMS migration. Two careful transitions, both done as a
-- single atomic block:
--   - Reservation gains roomTypeId (mandatory). Backfill from
--     Room.roomTypeId for every existing row before the NOT NULL
--     constraint goes on.
--   - Reservation.roomId becomes nullable (was required). Type-bound
--     reservations from OTAs leave this null until check-in assigns a
--     specific room.
-- Plus additive fields:
--   externalRef, commissionPercent, prepaid on Reservation
--   tourismTaxPercent, icalExportToken on Hotel
-- Plus 5 new ReservationSource enum values: EXPEDIA, TRIPADVISOR,
-- HOSTELWORLD, VRBO, AGODA.

-- ─── Hotel additions ─────────────────────────────────────────────
ALTER TABLE "Hotel" ADD COLUMN "tourismTaxPercent" DECIMAL(5, 2);
ALTER TABLE "Hotel" ADD COLUMN "icalExportToken" TEXT;
CREATE UNIQUE INDEX "Hotel_icalExportToken_key" ON "Hotel"("icalExportToken");

-- ─── Source enum extensions ──────────────────────────────────────
ALTER TYPE "ReservationSource" ADD VALUE IF NOT EXISTS 'EXPEDIA';
ALTER TYPE "ReservationSource" ADD VALUE IF NOT EXISTS 'TRIPADVISOR';
ALTER TYPE "ReservationSource" ADD VALUE IF NOT EXISTS 'HOSTELWORLD';
ALTER TYPE "ReservationSource" ADD VALUE IF NOT EXISTS 'VRBO';
ALTER TYPE "ReservationSource" ADD VALUE IF NOT EXISTS 'AGODA';

-- ─── Reservation additions ───────────────────────────────────────
ALTER TABLE "Reservation" ADD COLUMN "externalRef" TEXT;
ALTER TABLE "Reservation" ADD COLUMN "commissionPercent" DECIMAL(5, 2);
ALTER TABLE "Reservation" ADD COLUMN "prepaid" BOOLEAN NOT NULL DEFAULT false;

-- ─── Room-type-level reservations ────────────────────────────────
-- Step 1: add roomTypeId nullable so we can backfill from existing
-- reservations' rooms.
ALTER TABLE "Reservation" ADD COLUMN "roomTypeId" TEXT;

-- Step 2: backfill — every existing reservation gets the type of its
-- currently-assigned room.
UPDATE "Reservation" r
SET "roomTypeId" = (SELECT "roomTypeId" FROM "Room" WHERE "id" = r."roomId");

-- Step 3: enforce NOT NULL now that every row has a value.
ALTER TABLE "Reservation" ALTER COLUMN "roomTypeId" SET NOT NULL;

-- Step 4: add the FK constraint.
ALTER TABLE "Reservation"
  ADD CONSTRAINT "Reservation_roomTypeId_fkey"
  FOREIGN KEY ("roomTypeId") REFERENCES "RoomType"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Step 5: drop the old NOT NULL on roomId so type-bound reservations
-- can leave it null until check-in.
ALTER TABLE "Reservation" ALTER COLUMN "roomId" DROP NOT NULL;

-- Step 6: drop the old FK so we can recreate it as ON DELETE SET NULL
-- (matches the new nullable shape — losing a room shouldn't cascade-
-- delete reservation history).
ALTER TABLE "Reservation" DROP CONSTRAINT "Reservation_roomId_fkey";
ALTER TABLE "Reservation"
  ADD CONSTRAINT "Reservation_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "Room"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Useful indexes on the new column for the availability and reports
-- queries.
CREATE INDEX "Reservation_hotelId_roomTypeId_idx" ON "Reservation"("hotelId", "roomTypeId");
