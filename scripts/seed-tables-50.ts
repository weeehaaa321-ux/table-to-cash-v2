import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Guard: refuse to run unless the caller explicitly opts in. This script
// writes 50 test tables and is easy to accidentally point at prod.
if (process.env.ALLOW_PROD_WRITE !== "1") {
  console.error("Refusing to run without ALLOW_PROD_WRITE=1.");
  console.error("Point DATABASE_URL at a Neon branch and re-run with ALLOW_PROD_WRITE=1.");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });

async function main() {
  const r = await db.restaurant.findUnique({ where: { slug: "blue-hole-kitchen" } });
  if (!r) throw new Error("Restaurant 'blue-hole-kitchen' not found. Run prisma/seed.ts first.");
  for (let i = 15; i <= 50; i++) {
    await db.table.upsert({
      where: { restaurantId_number: { restaurantId: r.id, number: i } },
      update: {},
      create: { number: i, label: `Table ${i}`, restaurantId: r.id },
    });
  }
  const total = await db.table.count({ where: { restaurantId: r.id } });
  console.log(`Total tables: ${total}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
