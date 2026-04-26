import { db } from "../src/lib/db";

async function main() {
  const sample = await db.menuItem.findMany({ take: 5, select: { id: true, name: true, tags: true } });
  console.log("Sample items:", JSON.stringify(sample));

  const emptyTags = await db.menuItem.count({ where: { tags: { isEmpty: true } } });
  console.log("Items with empty tags:", emptyTags);

  const nonEmpty = await db.menuItem.count({ where: { tags: { isEmpty: false } } });
  console.log("Items with non-empty tags:", nonEmpty);

  process.exit(0);
}
main();
