-- Comp fields on OrderItem
ALTER TABLE "OrderItem"
  ADD COLUMN "comped"     BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN "compReason" TEXT,
  ADD COLUMN "compedBy"   TEXT,
  ADD COLUMN "compedAt"   TIMESTAMP(3);

-- DailyClose: one snapshot per restaurant per business day
CREATE TABLE "DailyClose" (
  "id"           TEXT         NOT NULL,
  "restaurantId" TEXT         NOT NULL,
  "date"         DATE         NOT NULL,
  "closedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedById"   TEXT,
  "closedByName" TEXT,
  "totals"       JSONB        NOT NULL,
  "notes"        TEXT,
  CONSTRAINT "DailyClose_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DailyClose_restaurantId_date_key"
  ON "DailyClose"("restaurantId", "date");

CREATE INDEX "DailyClose_restaurantId_closedAt_idx"
  ON "DailyClose"("restaurantId", "closedAt");

-- StaffShift: actual clock-in / clock-out intervals
CREATE TABLE "StaffShift" (
  "id"           TEXT         NOT NULL,
  "staffId"      TEXT         NOT NULL,
  "restaurantId" TEXT         NOT NULL,
  "clockIn"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "clockOut"     TIMESTAMP(3),
  "notes"        TEXT,
  CONSTRAINT "StaffShift_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StaffShift_staffId_clockIn_idx"
  ON "StaffShift"("staffId", "clockIn");

CREATE INDEX "StaffShift_restaurantId_clockIn_idx"
  ON "StaffShift"("restaurantId", "clockIn");
