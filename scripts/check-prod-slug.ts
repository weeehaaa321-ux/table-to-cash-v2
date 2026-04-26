import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });

async function main() {
  const all = await db.restaurant.findMany({ select: { id: true, name: true, slug: true } });
  console.log("Restaurants in DB:");
  for (const r of all) console.log(`  ${r.slug} — ${r.name} (${r.id})`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
