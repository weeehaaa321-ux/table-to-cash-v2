-- Service-model toggle. Lets the owner switch the whole restaurant
-- between the legacy waiter flow (auto-assign + per-waiter tipping)
-- and a runner flow (shared READY queue + service charge) without
-- a redeploy. Both modes coexist in code; this column gates which
-- branch each request takes.
--
-- Defaults preserve current behavior. Existing rows get
-- serviceModel = WAITER and serviceChargePercent = 0 — no operational
-- change until an owner explicitly toggles.

CREATE TYPE "ServiceModel" AS ENUM ('WAITER', 'RUNNER');

ALTER TABLE "Restaurant"
  ADD COLUMN "serviceModel" "ServiceModel" NOT NULL DEFAULT 'WAITER',
  ADD COLUMN "serviceChargePercent" DECIMAL(5, 2) NOT NULL DEFAULT 0;

ALTER TABLE "Staff"
  ADD COLUMN "isCaptain" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Order"
  ADD COLUMN "serviceCharge" DECIMAL(10, 2) NOT NULL DEFAULT 0;
