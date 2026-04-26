-- Time-of-day availability for menu items (e.g. breakfast 8-13 Cairo)
ALTER TABLE "MenuItem" ADD COLUMN "availableFromHour" INTEGER;
ALTER TABLE "MenuItem" ADD COLUMN "availableToHour" INTEGER;
