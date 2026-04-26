-- Convert every monetary field from DOUBLE PRECISION to NUMERIC(10,2).
-- After #8's Math.round at every write site, every value already in
-- the DB is a whole-EGP integer that fits cleanly into NUMERIC(10,2),
-- so the USING cast is loss-free. Going forward, Postgres rejects
-- anything that wouldn't fit (>99,999,999.99 or extra decimal places),
-- giving us defense-in-depth on top of the application-side rounding.

ALTER TABLE "MenuItem"
  ALTER COLUMN "price" TYPE NUMERIC(10,2) USING ("price"::NUMERIC(10,2));

ALTER TABLE "AddOn"
  ALTER COLUMN "price" TYPE NUMERIC(10,2) USING ("price"::NUMERIC(10,2));

ALTER TABLE "Order"
  ALTER COLUMN "subtotal" TYPE NUMERIC(10,2) USING ("subtotal"::NUMERIC(10,2)),
  ALTER COLUMN "tax" TYPE NUMERIC(10,2) USING ("tax"::NUMERIC(10,2)),
  ALTER COLUMN "total" TYPE NUMERIC(10,2) USING ("total"::NUMERIC(10,2)),
  ALTER COLUMN "tip" TYPE NUMERIC(10,2) USING ("tip"::NUMERIC(10,2)),
  ALTER COLUMN "deliveryFee" TYPE NUMERIC(10,2) USING ("deliveryFee"::NUMERIC(10,2));

ALTER TABLE "OrderItem"
  ALTER COLUMN "price" TYPE NUMERIC(10,2) USING ("price"::NUMERIC(10,2));

ALTER TABLE "Promo"
  ALTER COLUMN "value" TYPE NUMERIC(10,2) USING ("value"::NUMERIC(10,2));

ALTER TABLE "CashSettlement"
  ALTER COLUMN "amount" TYPE NUMERIC(10,2) USING ("amount"::NUMERIC(10,2));

ALTER TABLE "CashDrawer"
  ALTER COLUMN "openingFloat" TYPE NUMERIC(10,2) USING ("openingFloat"::NUMERIC(10,2)),
  ALTER COLUMN "closingCount" TYPE NUMERIC(10,2) USING ("closingCount"::NUMERIC(10,2)),
  ALTER COLUMN "expectedCash" TYPE NUMERIC(10,2) USING ("expectedCash"::NUMERIC(10,2)),
  ALTER COLUMN "variance" TYPE NUMERIC(10,2) USING ("variance"::NUMERIC(10,2));
