// Run with: npx tsx scripts/clear-data.ts
// Must be run from project root

import "dotenv/config";
import { db } from "../src/lib/db";

async function main() {
  const restaurantId = "cmnlszbcf00004ouku8oforz4";

  const orders = await db.order.findMany({
    where: { restaurantId },
    select: { id: true },
  });
  console.log("Found", orders.length, "orders");

  if (orders.length > 0) {
    const r = await db.orderItem.deleteMany({
      where: { orderId: { in: orders.map((o) => o.id) } },
    });
    console.log("Deleted", r.count, "order items");
  }

  const d1 = await db.order.deleteMany({ where: { restaurantId } });
  const d2 = await db.tableSession.deleteMany({ where: { restaurantId } });
  const d3 = await db.message.deleteMany({ where: { restaurantId } });

  console.log("Cleared:", d1.count, "orders,", d2.count, "sessions,", d3.count, "messages");
}

main();
