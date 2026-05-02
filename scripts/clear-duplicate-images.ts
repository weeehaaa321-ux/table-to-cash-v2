// ═══════════════════════════════════════════════════════
// CLEAR DUPLICATE MENU IMAGES
//
// For every set of items that share the same image URL, keep the
// image on the LOWEST-sortOrder item in the set and null out the
// rest. Cleared items render the generic 🍽 emoji placeholder per
// src/lib/placeholders.ts → resolveImage(null).
//
// Why null and not "use a different image": picking another
// Unsplash photo blindly risks reintroducing the same problem (a
// random ID we haven't verified). A clean placeholder is honest
// — the owner sees clearly which items still need a real photo
// uploaded via the admin panel.
//
// Idempotent — safe to re-run.
//
// Run with --apply to actually write. Without it, this script
// only prints what it WOULD change (dry-run by default).
//
//   Dry run:  npx tsx scripts/clear-duplicate-images.ts
//   Apply:    npx tsx scripts/clear-duplicate-images.ts --apply
// ═══════════════════════════════════════════════════════

import "dotenv/config";
import { db } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");

async function main() {
  const items = await db.menuItem.findMany({
    where: { available: true },
    orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }],
    select: {
      id: true,
      name: true,
      image: true,
      sortOrder: true,
      category: { select: { slug: true, sortOrder: true } },
    },
  });

  // Group by image URL.
  const byImage = new Map<string, typeof items>();
  for (const i of items) {
    if (!i.image) continue;
    const key = i.image.trim();
    if (!byImage.has(key)) byImage.set(key, []);
    byImage.get(key)!.push(i);
  }

  const duplicates = Array.from(byImage.entries()).filter(([, g]) => g.length > 1);
  if (duplicates.length === 0) {
    console.log("No duplicates to clear. Database is clean.");
    return;
  }

  // For each duplicate set, keep the image on the item with the
  // lowest (category.sortOrder, item.sortOrder) tuple — so the
  // "primary" item in its category keeps the photo. The rest get
  // their image cleared.
  const toClear: { id: string; name: string; categorySlug: string }[] = [];
  for (const [, group] of duplicates) {
    const sorted = [...group].sort((a, b) => {
      if (a.category.sortOrder !== b.category.sortOrder) {
        return a.category.sortOrder - b.category.sortOrder;
      }
      return a.sortOrder - b.sortOrder;
    });
    // Keep sorted[0]; clear sorted[1..]
    for (let i = 1; i < sorted.length; i++) {
      toClear.push({
        id: sorted[i].id,
        name: sorted[i].name,
        categorySlug: sorted[i].category.slug,
      });
    }
  }

  console.log(
    `${toClear.length} items will have their image cleared (kept on the primary item per duplicate set):\n`,
  );
  for (const c of toClear) {
    console.log(`  · [${c.categorySlug}] ${c.name}`);
  }
  console.log("");

  if (!APPLY) {
    console.log("Dry run — no changes written.");
    console.log("Re-run with --apply to actually clear.");
    return;
  }

  // Bulk update.
  const result = await db.menuItem.updateMany({
    where: { id: { in: toClear.map((c) => c.id) } },
    data: { image: null },
  });
  console.log(`Cleared image on ${result.count} items.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
