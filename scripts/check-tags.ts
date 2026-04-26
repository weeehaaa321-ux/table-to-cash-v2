import { db } from "../src/lib/db";

async function main() {
  const items = await db.menuItem.findMany({ select: { name: true, tags: true, bestSeller: true, highMargin: true } });
  const withTags = items.filter(i => i.tags.length > 0);
  console.log("Total items:", items.length);
  console.log("Items with tags:", withTags.length);
  console.log("Best sellers:", items.filter(i => i.bestSeller).length);
  console.log("High margin:", items.filter(i => i.highMargin).length);
  if (withTags.length > 0) console.log("Sample:", JSON.stringify(withTags.slice(0, 5)));
  else console.log("NO ITEMS HAVE TAGS — upselling has no data to work with");
  process.exit(0);
}
main();
