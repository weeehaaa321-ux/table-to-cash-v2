-- Cashier-applied discount in EGP, per Order. Lives alongside `tip` —
-- the gross `total` stays untouched (so item-line math + revenue
-- rollups don't need to know about discounts), and the cashier
-- collects `total - discount` at the moment of settle. Set on the
-- first order of a paid round at confirmPayRound time.

ALTER TABLE "Order"
  ADD COLUMN "discount" DECIMAL(10, 2) NOT NULL DEFAULT 0;
