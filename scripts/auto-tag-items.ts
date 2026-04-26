import { db } from "../src/lib/db";

const CATEGORY_TAG_MAP: Record<string, string[]> = {
  "breakfast": ["breakfast", "main"],
  "egg": ["breakfast", "main"],
  "chef": ["main"],
  "juice": ["drink", "juice"],
  "soft drink": ["drink"],
  "ice cream": ["dessert"],
  "milkshake": ["drink", "dessert"],
  "dessert": ["dessert"],
  "cocktail": ["drink", "cocktail"],
  "energy": ["drink"],
  "smoothie": ["drink", "juice"],
  "coffee": ["drink", "coffee"],
  "iced coffee": ["drink", "coffee"],
  "iced drink": ["drink"],
  "tea": ["drink", "coffee"],
  "sahlab": ["drink"],
  "salad": ["starter", "appetizer"],
  "starter": ["appetizer", "starter", "sharing"],
  "snack": ["appetizer", "starter"],
  "soup": ["starter", "appetizer"],
  "pasta": ["main"],
  "burger": ["main"],
  "pizza": ["main"],
  "sandwich": ["main"],
  "main": ["main"],
  "grill": ["main"],
  "seafood": ["main"],
  "steak": ["main"],
  "wrap": ["main"],
  "extra": ["extra"],
  "side": ["extra", "starter"],
};

function inferTags(categoryName: string): string[] {
  const lower = categoryName.toLowerCase();
  for (const [keyword, tags] of Object.entries(CATEGORY_TAG_MAP)) {
    if (lower.includes(keyword)) return tags;
  }
  return [];
}

async function main() {
  const categories = await db.category.findMany({
    select: { id: true, name: true },
  });

  let updated = 0;

  for (const cat of categories) {
    const tags = inferTags(cat.name);
    if (tags.length === 0) {
      console.log(`  SKIP: "${cat.name}" — no matching keywords`);
      continue;
    }

    // Find items with no tags (empty array or tags with 0 length)
    const items = await db.menuItem.findMany({
      where: { categoryId: cat.id },
      select: { id: true, name: true, tags: true },
    });

    const untagged = items.filter((i) => i.tags.length === 0);
    if (untagged.length === 0) {
      console.log(`  "${cat.name}" — all ${items.length} items already tagged`);
      continue;
    }

    for (const item of untagged) {
      await db.menuItem.update({
        where: { id: item.id },
        data: { tags },
      });
    }

    updated += untagged.length;
    console.log(`  "${cat.name}" → [${tags.join(", ")}] — ${untagged.length} items tagged`);
  }

  console.log(`\nDone: ${updated} items tagged`);
  process.exit(0);
}

main();
