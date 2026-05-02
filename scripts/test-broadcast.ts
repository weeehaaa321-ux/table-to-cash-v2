// Times sendPushToRestaurant locally to confirm it actually completes
// fast and tries every subscription for the restaurant.
import "dotenv/config";
import { sendPushToRestaurant } from "../src/lib/web-push";
import { db } from "../src/lib/db";

async function main() {
  const r = await db.restaurant.findFirst({ select: { id: true, name: true, slug: true } });
  if (!r) { console.log("no restaurant"); return; }
  console.log(`Restaurant: ${r.name} (${r.id})`);

  const subs = await db.pushSubscription.findMany({
    where: { restaurantId: r.id },
    select: { id: true, staffId: true, role: true, endpoint: true, staff: { select: { name: true } } },
  });
  console.log(`Subs in restaurant: ${subs.length}`);
  for (const s of subs) {
    console.log(`  · ${s.staff?.name} (${s.role}) endpoint=${s.endpoint.slice(0, 60)}...`);
  }

  console.log("\nFiring sendPushToRestaurant...");
  const t0 = Date.now();
  try {
    await sendPushToRestaurant(r.id, {
      title: { en: "Broadcast test", ar: "اختبار" },
      body: { en: "This is a sendPushToRestaurant test", ar: "هذا اختبار" },
      tag: `broadcast-test-${Date.now()}`,
      url: "/waiter",
    });
    const t1 = Date.now();
    console.log(`Returned in ${t1 - t0}ms`);
  } catch (err) {
    console.log(`Threw after ${Date.now() - t0}ms:`, (err as Error).message);
  }
}

main().finally(() => db.$disconnect());
