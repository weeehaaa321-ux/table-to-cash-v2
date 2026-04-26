-- AlterTable: persist the delivery fee on Order so receipts and
-- reports stop deriving it from a magic constant in three different UIs.
ALTER TABLE "Order" ADD COLUMN "deliveryFee" DOUBLE PRECISION NOT NULL DEFAULT 0;
