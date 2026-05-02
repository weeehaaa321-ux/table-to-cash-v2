// ═══════════════════════════════════════════════════════
// REVERT MENU PHOTOS
//
// Reads the original Unsplash IDs out of scripts/seed-menu.ts and
// applies them to matching menu items in the production database.
// Items not present in the seed (added later via admin panel) are
// left untouched.
//
// Use this to undo a bad bulk-photo update: re-establishes the
// previous (imperfect but at least food-categorized) photos.
//
// Run:
//   Dry run:  npx tsx scripts/revert-menu-photos.ts
//   Apply:    npx tsx scripts/revert-menu-photos.ts --apply
// ═══════════════════════════════════════════════════════

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { db } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");

function buildImageUrl(longId: string): string {
  return `https://images.unsplash.com/photo-${longId}?w=600&h=450&fit=crop&q=80`;
}

function parseSeed(): Map<string, string> {
  // Each entry in seed-menu.ts looks like:
  //   { name: "English Breakfast", nameAr: "...",
  //     description: "...", price: 270, image: u("1525351484163-7529414344d8"), ... }
  // We grep for the (name, image) pairs and build a map.
  const file = path.join(__dirname, "seed-menu.ts");
  const text = fs.readFileSync(file, "utf-8");
  const map = new Map<string, string>();
  // Match item entries — name comes before image in the same line/block.
  const rx = /name:\s*"([^"]+)"[\s\S]*?image:\s*u\(\s*"([0-9a-f-]+)"\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) {
    map.set(m[1], m[2]);
  }
  return map;
}

async function main() {
  const seed = parseSeed();
  console.log(`Seed file has ${seed.size} (name → image) pairs.`);

  const items = await db.menuItem.findMany({
    where: { available: true },
    select: { id: true, name: true, image: true, category: { select: { slug: true } } },
  });

  type Plan = { id: string; name: string; oldImage: string | null; newImage: string };
  const plan: Plan[] = [];
  const noSeedMatch: { name: string; categorySlug: string }[] = [];

  for (const item of items) {
    const seededId = seed.get(item.name);
    if (!seededId) {
      noSeedMatch.push({ name: item.name, categorySlug: item.category.slug });
      continue;
    }
    const newUrl = buildImageUrl(seededId);
    if (item.image === newUrl) continue; // already on the seeded photo
    plan.push({ id: item.id, name: item.name, oldImage: item.image, newImage: newUrl });
  }

  console.log(`\n${plan.length} items will be reverted to their seeded photo.`);
  if (noSeedMatch.length > 0) {
    console.log(`\n${noSeedMatch.length} items have no entry in seed-menu.ts (added via admin panel). Untouched:`);
    for (const n of noSeedMatch) console.log(`  · [${n.categorySlug}] ${n.name}`);
  }

  if (!APPLY) {
    console.log("\nDry run — no changes written.");
    console.log("Re-run with --apply to write the seeded photos back.");
    return;
  }

  const BATCH = 25;
  let done = 0;
  for (let i = 0; i < plan.length; i += BATCH) {
    const chunk = plan.slice(i, i + BATCH);
    await Promise.all(
      chunk.map((p) =>
        db.menuItem.update({
          where: { id: p.id },
          data: { image: p.newImage },
        }),
      ),
    );
    done += chunk.length;
    process.stdout.write(`  reverted ${done}/${plan.length}\r`);
  }
  console.log(`\nDone — ${done} items reverted.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
