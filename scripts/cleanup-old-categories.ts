import { PrismaClient } from "../src/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const url = process.env.DATABASE_URL!;
const cleanUrl = url.replace(/[&?]channel_binding=[^&]*/g, "");
const adapter = new PrismaPg({ connectionString: cleanUrl });
const db = new PrismaClient({ adapter });

async function main() {
  const oldCats = await db.category.findMany({
    where: { name: { contains: "[OLD]" } },
    select: { id: true, name: true, _count: { select: { items: true } } },
  });

  console.log(`Found ${oldCats.length} [OLD] categories`);

  for (const cat of oldCats) {
    if (cat._count.items > 0) {
      const del = await db.menuItem.deleteMany({ where: { categoryId: cat.id } });
      console.log(`  Deleted ${del.count} items from "${cat.name}"`);
    }
    await db.category.delete({ where: { id: cat.id } });
    console.log(`  Deleted category "${cat.name}" (${cat.id})`);
  }

  console.log("Done!");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
