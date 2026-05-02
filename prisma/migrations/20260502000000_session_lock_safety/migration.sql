-- Partial unique index: at most one OPEN session per table at a time.
--
-- Defends against the "two guests scan simultaneously" race that
-- previously created two OPEN TableSession rows on the same tableId.
-- VIP / delivery sessions have tableId NULL; the IS NOT NULL guard
-- excludes them so they keep their many-to-one relationship.
--
-- Postgres treats NULL as distinct in unique indexes by default, so
-- the IS NOT NULL clause is belt-and-braces explicit. Using a
-- partial index keeps CLOSED rows free of the constraint, so the
-- table can have any number of past sessions per table — only one
-- can be OPEN at a time.

CREATE UNIQUE INDEX IF NOT EXISTS "TableSession_tableId_open_unique"
  ON "TableSession" ("tableId")
  WHERE "status" = 'OPEN' AND "tableId" IS NOT NULL;
