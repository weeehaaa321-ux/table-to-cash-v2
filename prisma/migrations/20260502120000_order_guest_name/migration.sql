-- Per-order guest name. Captured on the scan flow when a guest joins
-- the table; populated on every order they place. Optional — orders
-- placed before this column existed (or by guests who skip the name
-- prompt) leave it NULL and the UI falls back to "Guest #N".
ALTER TABLE "Order" ADD COLUMN "guestName" TEXT;
