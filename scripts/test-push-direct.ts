// Sends a real web-push to every subscription in the DB, using the
// LOCAL .env's VAPID keys. Reports per-subscription success/failure
// with the actual error so we can see whether the push code works
// independent of any Vercel-deployment / env-var concerns.
import "dotenv/config";
import webpush from "web-push";
import { db } from "../src/lib/db";

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";
const rawSubject = process.env.VAPID_SUBJECT || "mailto:admin@tableto.cash";
const VAPID_SUBJECT = rawSubject.startsWith("mailto:") ? rawSubject : `mailto:${rawSubject}`;

console.log(`VAPID public:  ${VAPID_PUBLIC ? `${VAPID_PUBLIC.slice(0, 16)}…(${VAPID_PUBLIC.length})` : "EMPTY"}`);
console.log(`VAPID private: ${VAPID_PRIVATE ? `(${VAPID_PRIVATE.length} chars)` : "EMPTY"}`);
console.log(`VAPID subject: ${VAPID_SUBJECT}\n`);

if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
  console.error("VAPID keys missing in local env; cannot send.");
  process.exit(1);
}

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

async function main() {
  const subs = await db.pushSubscription.findMany({
    select: {
      id: true,
      endpoint: true,
      p256dh: true,
      auth: true,
      staff: { select: { name: true } },
    },
  });

  console.log(`Sending test push to ${subs.length} subscription(s)…\n`);

  for (const sub of subs) {
    const name = sub.staff?.name ?? "(unknown)";
    try {
      const res = await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        JSON.stringify({
          title: "Test push from script",
          body: "If you see this, push works end-to-end.",
          tag: `test-${Date.now()}`,
          url: "/waiter",
        }),
        { TTL: 60 },
      );
      console.log(`  ✓ ${name}: ${res.statusCode} ${res.statusText || ""}`);
    } catch (err: unknown) {
      const e = err as { statusCode?: number; body?: string; message?: string };
      console.log(`  ✗ ${name}: status=${e.statusCode ?? "?"} message=${e.message ?? ""}`);
      if (e.body) console.log(`      body: ${e.body.slice(0, 200)}`);
    }
  }
}

main().finally(() => db.$disconnect());
