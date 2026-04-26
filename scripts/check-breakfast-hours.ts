import { db } from "../src/lib/db";

async function main() {
const items = await db.menuItem.findMany({
  where: { category: { restaurant: { slug: "neom-dahab" } } },
  select: {
    name: true,
    availableFromHour: true,
    availableToHour: true,
    category: { select: { name: true } },
  },
  orderBy: { category: { name: "asc" } },
});

const configured = items.filter((i) => i.availableFromHour != null || i.availableToHour != null);
console.log(`Total items: ${items.length}`);
console.log(`With time-window set: ${configured.length}`);
console.log("");
if (configured.length > 0) {
  console.log("Configured items:");
  for (const i of configured) console.log(`  [${i.category.name}] ${i.name}: ${i.availableFromHour ?? "-"} → ${i.availableToHour ?? "-"}`);
}
const breakfastLike = items.filter((i) => /breakfast|فطار|fitar|فطور/i.test(i.name + " " + i.category.name));
if (breakfastLike.length > 0) {
  console.log("");
  console.log("Breakfast-named items:");
  for (const i of breakfastLike) console.log(`  [${i.category.name}] ${i.name}: from=${i.availableFromHour} to=${i.availableToHour}`);
}
process.exit(0);
}
main();
