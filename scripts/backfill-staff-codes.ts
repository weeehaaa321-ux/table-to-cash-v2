// One-off: assign a short human-readable `code` to every non-OWNER Staff
// row that doesn't already have one. Run with:
//   npx dotenv-cli -e .env -- npx tsx scripts/backfill-staff-codes.ts
//
// Safe to re-run: only fills rows where code IS NULL. OWNER rows are
// skipped (they don't need a code).

import "dotenv/config";
import { db } from "../src/lib/db";
import { generateStaffCode } from "../src/lib/staff-code";

async function main() {
  const rows = await db.staff.findMany({
    where: { code: null, role: { not: "OWNER" } },
    select: { id: true, role: true, restaurantId: true, name: true },
  });

  if (rows.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  console.log(`Backfilling ${rows.length} staff row(s)...`);

  for (const s of rows) {
    // Retry until we find a code not already used in this restaurant.
    let attempts = 0;
    for (;;) {
      const candidate = generateStaffCode(s.role);
      const clash = await db.staff.findFirst({
        where: { restaurantId: s.restaurantId, code: candidate },
        select: { id: true },
      });
      if (!clash) {
        await db.staff.update({ where: { id: s.id }, data: { code: candidate } });
        console.log(`  ${s.name} (${s.role}) -> ${candidate}`);
        break;
      }
      if (++attempts > 20) throw new Error(`Could not allocate unique code for ${s.id}`);
    }
  }

  console.log("Done.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
