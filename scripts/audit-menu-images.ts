// ═══════════════════════════════════════════════════════
// MENU IMAGE AUDIT
//
// Scans every menu item in the production database, groups them by
// image URL, and prints:
//   1. Duplicate sets — one image used for two or more different items.
//   2. Items with no image at all (which will fall back to the
//      generic 🍽 placeholder per src/lib/placeholders.ts).
//
// Run:  npx tsx scripts/audit-menu-images.ts
//
// Read-only — does not modify the database.
// To actually clear the duplicate images, run:
//       npx tsx scripts/clear-duplicate-images.ts
// ═══════════════════════════════════════════════════════

import "dotenv/config";
import { db } from "../src/lib/db";

async function main() {
  const items = await db.menuItem.findMany({
    where: { available: true },
    orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
    select: {
      id: true,
      name: true,
      nameAr: true,
      image: true,
      category: { select: { name: true, slug: true } },
    },
  });

  console.log(`\nTotal available items: ${items.length}\n`);

  const noImage = items.filter((i) => !i.image || i.image.trim() === "");
  if (noImage.length > 0) {
    console.log(`━━━ Items with NO image (${noImage.length}) ━━━`);
    for (const i of noImage) {
      console.log(`  · [${i.category.slug}] ${i.name}`);
    }
    console.log("");
  }

  // Group by image URL — items sharing the same URL are duplicates.
  const byImage = new Map<string, typeof items>();
  for (const i of items) {
    if (!i.image) continue;
    const key = i.image.trim();
    if (!byImage.has(key)) byImage.set(key, []);
    byImage.get(key)!.push(i);
  }

  const duplicates = Array.from(byImage.entries())
    .filter(([, group]) => group.length > 1)
    .sort(([, a], [, b]) => b.length - a.length);

  if (duplicates.length === 0) {
    console.log("No duplicate images found.\n");
  } else {
    console.log(
      `━━━ Duplicate images (${duplicates.length} URLs reused, ${duplicates.reduce(
        (s, [, g]) => s + g.length,
        0,
      )} affected items) ━━━`,
    );
    for (const [url, group] of duplicates) {
      console.log(`\n[${group.length}×] ${url.slice(0, 80)}${url.length > 80 ? "..." : ""}`);
      for (const i of group) {
        console.log(`  · [${i.category.slug}] ${i.name}`);
      }
    }
    console.log("");
  }

  console.log(
    `Summary: ${items.length} items, ${noImage.length} without images, ${duplicates.length} reused URLs covering ${duplicates.reduce((s, [, g]) => s + g.length, 0)} items.`,
  );
  console.log("");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
