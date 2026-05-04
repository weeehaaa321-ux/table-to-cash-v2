-- Activities support, part 2: per-item billing rate + timer columns.
-- pricePerHour on MenuItem drives prorated billing for hourly
-- activities (kayak / board / massage). activityStartedAt and
-- activityStoppedAt on OrderItem track the timer pair.

ALTER TABLE "MenuItem"
  ADD COLUMN "pricePerHour" DECIMAL(10, 2);

ALTER TABLE "OrderItem"
  ADD COLUMN "activityStartedAt" TIMESTAMP(3),
  ADD COLUMN "activityStoppedAt" TIMESTAMP(3);
