-- Performance indexes targeting hot query patterns identified via
-- code audit (no Neon slow-query log was available; these target
-- queries we KNOW are run during normal operation).

-- /api/shifts/cashout, /api/daily-close: filter Order by
-- (paymentMethod, paidAt range). Without this, Postgres scans by
-- paidAt (which has no index) or by restaurantId+createdAt (which
-- doesn't help payment-method queries).
CREATE INDEX IF NOT EXISTS "Order_paymentMethod_paidAt_idx"
  ON "Order"("paymentMethod", "paidAt");

-- /api/analytics: filters by (restaurantId, paidAt range, status).
-- The existing (restaurantId, createdAt) index doesn't help when
-- the route filters specifically on paidAt — analytics queries
-- have been doing a partial-table scan.
CREATE INDEX IF NOT EXISTS "Order_restaurantId_paidAt_idx"
  ON "Order"("restaurantId", "paidAt");

-- /api/clock?restaurantId=...: lists open shifts (clockOut IS NULL).
-- Existing (restaurantId, clockIn) index can serve it but is wasteful
-- because Postgres scans every clockIn just to check NULL on clockOut.
-- A partial index on the open subset is cheap and dramatic.
CREATE INDEX IF NOT EXISTS "StaffShift_restaurantId_open_idx"
  ON "StaffShift"("restaurantId") WHERE "clockOut" IS NULL;

-- web-push: sendPushToRole filters PushSubscription by
-- (restaurantId, role). No existing compound index — current
-- (restaurantId) index helps but the role filter is a sequential
-- pass over the restaurant's subs.
CREATE INDEX IF NOT EXISTS "PushSubscription_restaurantId_role_idx"
  ON "PushSubscription"("restaurantId", "role");
