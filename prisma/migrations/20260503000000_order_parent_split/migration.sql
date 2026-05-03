-- Split-pay: an Order can be the result of a split from another Order.
-- parentOrderId points at the original; on pay-cancel / reverse the
-- splitter merges the items back into the parent and drops this row.

ALTER TABLE "Order"
  ADD COLUMN "parentOrderId" TEXT;

ALTER TABLE "Order"
  ADD CONSTRAINT "Order_parentOrderId_fkey"
  FOREIGN KEY ("parentOrderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Order_parentOrderId_idx" ON "Order"("parentOrderId");
