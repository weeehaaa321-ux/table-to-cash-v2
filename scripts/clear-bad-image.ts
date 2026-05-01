// One-off: clear the wrong photo (a woman's portrait) that was set on
// 5 menu items — Umm Ali (Plain), Umm Ali with Nuts, Banana with Milk,
// Banana with Caramel, Banana Milkshake. The seed file no longer points
// to it; this script scrubs the existing prod rows. Safe to re-run —
// only updates rows whose image still references the bad URL.
//
// Run with:
//   npx dotenv-cli -e .env -- npx tsx scripts/clear-bad-image.ts

import "dotenv/config";
import { db } from "../src/lib/db";

const BAD_IMAGE_FRAGMENT = "1571019613454-1cb2f99b2d8b";

async function main() {
  const hits = await db.menuItem.findMany({
    where: { image: { contains: BAD_IMAGE_FRAGMENT } },
    select: { id: true, name: true },
  });

  if (hits.length === 0) {
    console.log("No menu items reference the bad image. Nothing to do.");
    return;
  }

  console.log(`Clearing image on ${hits.length} item(s):`);
  for (const item of hits) console.log(`  - ${item.name}`);

  const result = await db.menuItem.updateMany({
    where: { image: { contains: BAD_IMAGE_FRAGMENT } },
    data: { image: null },
  });

  console.log(`Done — ${result.count} row(s) updated.`);
}

main()
  .catch((err) => {
    console.error("clear-bad-image failed:", err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
