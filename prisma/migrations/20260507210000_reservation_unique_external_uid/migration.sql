-- Defeat duplicate creation when concurrent iCal syncs both think a
-- UID is new. Postgres treats NULL as distinct so non-OTA rows
-- (externalUid IS NULL) are unaffected.
--
-- Replaces the application-level mutex we considered: with this
-- constraint, the second writer hits a P2002 and the sync code
-- catches+skips. Cleaner than holding an advisory lock for the
-- duration of a multi-feed sync.
CREATE UNIQUE INDEX "Reservation_hotelId_externalUid_key"
  ON "Reservation"("hotelId", "externalUid");
