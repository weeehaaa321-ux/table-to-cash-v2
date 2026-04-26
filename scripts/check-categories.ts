import { db } from "../src/lib/db";

async function main() {
  const cats = await db.category.findMany({
    select: { id: true, name: true, _count: { select: { items: true } } },
    orderBy: { sortOrder: "asc" },
  });
  for (const c of cats) {
    console.log(`${c.name} (${c._count.items} items)`);
  }
  process.exit(0);
}
main();
