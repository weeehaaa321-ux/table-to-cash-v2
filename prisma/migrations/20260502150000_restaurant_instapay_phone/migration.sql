-- Per-restaurant InstaPay phone number, alongside the handle. Many
-- Egyptian banking apps let you send to a phone number registered
-- with InstaPay; some guests will know that flow better than the
-- alias flow. Showing both means the guest picks whichever their
-- bank app supports without having to ask.
ALTER TABLE "Restaurant" ADD COLUMN "instapayPhone" TEXT;
