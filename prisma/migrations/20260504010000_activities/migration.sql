-- Activities support, part 1: extend the Station enum.
-- ALTER TYPE ... ADD VALUE has historical restrictions about running
-- inside a transaction, so it lives in its own migration file before
-- any DDL references the new value.

ALTER TYPE "Station" ADD VALUE IF NOT EXISTS 'ACTIVITY';
