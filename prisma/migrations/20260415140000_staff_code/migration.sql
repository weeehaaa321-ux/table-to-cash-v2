-- Add Staff.code: short unique per-restaurant identifier to disambiguate
-- duplicate names. Nullable because OWNER rows don't need one and legacy
-- data is backfilled by scripts/backfill-staff-codes.ts before any caller
-- begins depending on it.
ALTER TABLE "Staff" ADD COLUMN "code" TEXT;

-- Per-restaurant uniqueness. Postgres treats multiple NULLs as distinct,
-- so OWNER rows (code IS NULL) don't collide with each other.
CREATE UNIQUE INDEX "Staff_restaurantId_code_key" ON "Staff"("restaurantId", "code");
