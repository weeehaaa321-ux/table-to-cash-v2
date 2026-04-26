import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });

async function main() {
  const r = await db.restaurant.findUnique({ where: { slug: "blue-hole-kitchen" } });
  console.log("Restaurant:", r?.id, r?.name, r?.slug);
  if (!r) return;
  const cats = await db.category.count({ where: { restaurantId: r.id } });
  const items = await db.menuItem.count({ where: { category: { restaurantId: r.id } } });
  const tables = await db.table.count({ where: { restaurantId: r.id } });
  console.log(`Categories: ${cats}, MenuItems: ${items}, Tables: ${tables}`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
