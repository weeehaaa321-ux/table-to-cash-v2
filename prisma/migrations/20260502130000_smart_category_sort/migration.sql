-- Smart category ordering for the guest menu.
--
-- Before this migration, categories were sortOrder 1-17 (drinks-heavy
-- seed) and 20-27 (food seed) — which left "Desserts" as the first
-- visible category whenever Breakfast was hidden by time-of-day rules.
-- This migration re-numbers every category by its slug so the menu
-- reads in a natural meal-flow order:
--
--   savory food (breakfast → starters → mains)
--     → desserts / ice cream
--     → standard drinks (juices → soft → coffee → tea)
--     → specialty drinks (smoothies / milkshakes / cocktails)
--     → extras
--
-- Idempotent: re-running an UPDATE WHERE slug=X is harmless. Categories
-- whose slug isn't listed below keep whatever sortOrder they had — so
-- a future custom slug doesn't get silently reshuffled.

-- Savory food
UPDATE "Category" SET "sortOrder" = 10  WHERE slug = 'breakfast';
UPDATE "Category" SET "sortOrder" = 20  WHERE slug = 'eggs';
UPDATE "Category" SET "sortOrder" = 30  WHERE slug = 'chefs-special';
UPDATE "Category" SET "sortOrder" = 40  WHERE slug = 'salads';
UPDATE "Category" SET "sortOrder" = 50  WHERE slug = 'soups';
UPDATE "Category" SET "sortOrder" = 60  WHERE slug = 'starters';
UPDATE "Category" SET "sortOrder" = 70  WHERE slug = 'main-course';
UPDATE "Category" SET "sortOrder" = 80  WHERE slug = 'pasta';
UPDATE "Category" SET "sortOrder" = 90  WHERE slug = 'pizza';
UPDATE "Category" SET "sortOrder" = 100 WHERE slug = 'burgers';
UPDATE "Category" SET "sortOrder" = 110 WHERE slug = 'sandwiches';

-- Sweet
UPDATE "Category" SET "sortOrder" = 120 WHERE slug = 'desserts';
UPDATE "Category" SET "sortOrder" = 130 WHERE slug = 'ice-cream';

-- Standard drinks
UPDATE "Category" SET "sortOrder" = 140 WHERE slug = 'fresh-juices';
UPDATE "Category" SET "sortOrder" = 150 WHERE slug = 'soft-drinks';
UPDATE "Category" SET "sortOrder" = 160 WHERE slug = 'coffee';
UPDATE "Category" SET "sortOrder" = 170 WHERE slug = 'iced-coffee';
UPDATE "Category" SET "sortOrder" = 180 WHERE slug = 'iced-drinks';
UPDATE "Category" SET "sortOrder" = 190 WHERE slug = 'tea-herbs';
UPDATE "Category" SET "sortOrder" = 200 WHERE slug = 'sahlab';

-- Specialty drinks (smoothies/shakes are heavier — natural after coffee)
UPDATE "Category" SET "sortOrder" = 210 WHERE slug = 'smoothies';
UPDATE "Category" SET "sortOrder" = 220 WHERE slug = 'milkshakes';
UPDATE "Category" SET "sortOrder" = 230 WHERE slug = 'energy-drinks';
UPDATE "Category" SET "sortOrder" = 240 WHERE slug = 'cocktails';

-- Misc
UPDATE "Category" SET "sortOrder" = 999 WHERE slug = 'extras';
