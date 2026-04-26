import { db } from "../src/lib/db";
import { toNum } from "../src/lib/money";

async function main() {
  const cats = await db.category.findMany({
    include: { items: { select: { name: true, price: true, bestSeller: true, highMargin: true, pairsWith: true, tags: true } } },
    orderBy: { sortOrder: "asc" },
  });
  for (const c of cats) {
    const prices = c.items.map(i => toNum(i.price));
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const avg = Math.round(prices.reduce((a,b)=>a+b,0)/prices.length);
    const bs = c.items.filter(i => i.bestSeller).length;
    const hm = c.items.filter(i => i.highMargin).length;
    const pw = c.items.filter(i => i.pairsWith.length > 0).length;
    console.log(`${c.name}: ${c.items.length} items, ${min}-${max} EGP (avg ${avg}), ${bs}bs ${hm}hm ${pw}pw, station=${c.station}`);
  }

  const hour = new Date().getHours();
  console.log(`\nCurrent hour: ${hour}`);
  console.log(`\nTotal bestSellers: ${cats.flatMap(c => c.items).filter(i => i.bestSeller).length}`);
  console.log(`Total highMargin: ${cats.flatMap(c => c.items).filter(i => i.highMargin).length}`);
  console.log(`Total with pairsWith: ${cats.flatMap(c => c.items).filter(i => i.pairsWith.length > 0).length}`);
  process.exit(0);
}
main();
