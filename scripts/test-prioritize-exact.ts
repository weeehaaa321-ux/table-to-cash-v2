// Reproduces the EXACT payload the dashboard sends for "Prioritize order"
// and fires it via the same broadcast path. If this buzzes the phone but
// the real dashboard doesn't, there's something wrong with the dashboard
// → /api/messages handoff. If neither buzzes, sendPushToRestaurant has
// a bug. Either way we get certainty.
import "dotenv/config";
import { sendPushToRestaurant } from "../src/lib/web-push";
import { db } from "../src/lib/db";

async function main() {
  const r = await db.restaurant.findFirst({ select: { id: true } });
  if (!r) return;

  // EXACT payload shape /api/messages would build for a prioritize command
  // (msg.to === "all", body.command === "prioritize"):
  const payload = {
    title: { en: "Message", ar: "رسالة" },
    body: "PRIORITY: Order #1234 (Table 7) — rush this order",
    tag: `msg-fake-${Date.now()}`,
    url: "/waiter",
  };
  const t0 = Date.now();
  try {
    await sendPushToRestaurant(r.id, payload);
    console.log(`Returned in ${Date.now() - t0}ms`);
  } catch (err) {
    console.log("Threw:", (err as Error).message);
  }
}

main().finally(() => db.$disconnect());
