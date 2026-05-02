-- Per-restaurant InstaPay handle. Shown to the guest on /track when
-- they pick INSTAPAY as the payment method, so they can transfer the
-- amount directly from their banking app to the cafe's account.
-- NULL = handle not configured; the guest sees a generic "head to
-- cashier" fallback so the payment flow doesn't dead-end.
ALTER TABLE "Restaurant" ADD COLUMN "instapayHandle" TEXT;
