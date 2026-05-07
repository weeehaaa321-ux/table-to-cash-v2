-- Hotel Phase 4: pricing rules + email config. All additive.

ALTER TABLE "Hotel" ADD COLUMN "notificationEmail" TEXT;
ALTER TABLE "Hotel" ADD COLUMN "emailFrom" TEXT;

ALTER TABLE "RoomType" ADD COLUMN "weekendRate" DECIMAL(10, 2);
ALTER TABLE "RoomType" ADD COLUMN "minNights" INTEGER NOT NULL DEFAULT 1;
