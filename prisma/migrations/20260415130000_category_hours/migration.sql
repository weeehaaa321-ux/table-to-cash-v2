-- Category-level time-of-day availability. Items inherit these hours
-- unless they override with their own availableFromHour/availableToHour.
-- Lets an owner set "Breakfast" category to 8-13 once and hide all
-- items inside it after 1pm without editing each row.
ALTER TABLE "Category" ADD COLUMN "availableFromHour" INTEGER;
ALTER TABLE "Category" ADD COLUMN "availableToHour" INTEGER;
