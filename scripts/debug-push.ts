import "dotenv/config";
import { db } from "../src/lib/db";

async function main() {
  console.log("\n━━━ PUSH DIAGNOSTICS ━━━\n");

  console.log("Env vars (loaded into THIS Node process — Vercel may differ):");
  console.log(`  NEXT_PUBLIC_VAPID_PUBLIC_KEY: ${process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ? `set (${process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY.length} chars)` : "EMPTY"}`);
  console.log(`  VAPID_PRIVATE_KEY:            ${process.env.VAPID_PRIVATE_KEY ? `set (${process.env.VAPID_PRIVATE_KEY.length} chars)` : "EMPTY"}`);
  console.log(`  VAPID_SUBJECT:                ${process.env.VAPID_SUBJECT ? `set (${process.env.VAPID_SUBJECT})` : "EMPTY"}`);
  console.log("");

  const subs = await db.pushSubscription.findMany({
    select: {
      id: true,
      staffId: true,
      role: true,
      restaurantId: true,
      lang: true,
      endpoint: true,
      createdAt: true,
      staff: { select: { name: true, role: true, active: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`Push subscriptions in DB: ${subs.length}\n`);
  for (const s of subs) {
    const endpointHost = (() => {
      try { return new URL(s.endpoint).host; } catch { return s.endpoint.slice(0, 40); }
    })();
    console.log(`  · ${s.staff?.name ?? "(no staff)"} [${s.role}] active=${s.staff?.active}`);
    console.log(`      created ${s.createdAt.toISOString()}`);
    console.log(`      endpoint host: ${endpointHost}`);
    console.log(`      lang: ${s.lang}`);
    console.log("");
  }

  if (subs.length === 0) {
    console.log("⚠ No push subscriptions exist in the database.");
    console.log("This is the bug. Devices have not been registering with the server.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
