import "dotenv/config";
import { db } from "../src/lib/db";

async function main() {
  const subs = await db.pushSubscription.findMany({
    select: {
      id: true,
      endpoint: true,
      p256dh: true,
      auth: true,
      restaurantId: true,
      role: true,
      lang: true,
      createdAt: true,
      updatedAt: true,
      staff: { select: { name: true } },
    },
  });
  for (const s of subs) {
    console.log("---");
    console.log(`staff: ${s.staff?.name}`);
    console.log(`role: ${s.role}`);
    console.log(`restaurantId: ${s.restaurantId}`);
    console.log(`endpoint: ${s.endpoint}`);
    console.log(`p256dh: ${s.p256dh} (${s.p256dh.length} chars)`);
    console.log(`auth: ${s.auth} (${s.auth.length} chars)`);
    console.log(`created: ${s.createdAt.toISOString()}`);
    console.log(`updated: ${s.updatedAt.toISOString()}`);
  }
}
main().finally(() => db.$disconnect());
