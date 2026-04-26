import { db } from "../src/lib/db";

async function main() {
  const updated = await db.restaurant.updateMany({
    where: { slug: "blue-hole-kitchen" },
    data: { name: "Neom Dahab" },
  });
  console.log(`Renamed ${updated.count} restaurant(s) to Neom Dahab`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
