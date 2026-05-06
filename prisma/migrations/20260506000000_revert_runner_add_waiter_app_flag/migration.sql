-- Revert the runner-mode columns added on 2026-05-04 and replace
-- with a single boolean flag that just turns the waiter app on/off
-- per restaurant. Service charge / service model / captain flag were
-- all added for a feature that's no longer the design.
--
-- Safe to drop: no production restaurant ever flipped to RUNNER mode,
-- so all rows still hold the column defaults (0 / WAITER / false).
-- The RUNNER value in StaffRole stays — Postgres can't drop enum
-- values cleanly and it's harmless dead code.

ALTER TABLE "Order"       DROP COLUMN IF EXISTS "serviceCharge";
ALTER TABLE "Restaurant"  DROP COLUMN IF EXISTS "serviceModel";
ALTER TABLE "Restaurant"  DROP COLUMN IF EXISTS "serviceChargePercent";
ALTER TABLE "Staff"       DROP COLUMN IF EXISTS "isCaptain";

DROP TYPE IF EXISTS "ServiceModel";

-- New, simpler flag. Default true preserves legacy behaviour for any
-- restaurant that doesn't explicitly opt out. Neom gets flipped to
-- false by a one-shot data update after this migration applies.
ALTER TABLE "Restaurant"
  ADD COLUMN "waiterAppEnabled" BOOLEAN NOT NULL DEFAULT true;
