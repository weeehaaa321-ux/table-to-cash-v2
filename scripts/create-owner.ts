// One-off: create an OWNER staff row so the dashboard PIN gate can be unlocked.
// Usage (PowerShell):
//   $env:DATABASE_URL="<prod-url>"; $env:OWNER_NAME="Omar"; $env:OWNER_PIN="1234"; npx tsx scripts/create-owner.ts
//
// Lists existing OWNERs first. If one already exists, prints its name/id and
// exits (use the Reset PIN button in the dashboard once you're in, or rerun
// with FORCE=1 to add another).

import { db } from "../src/lib/db";
import bcrypt from "bcryptjs";

async function main() {
  const name = process.env.OWNER_NAME?.trim();
  const pin = process.env.OWNER_PIN?.trim();
  const force = process.env.FORCE === "1";

  if (!name || !pin) {
    console.error("Set OWNER_NAME and OWNER_PIN env vars.");
    process.exit(1);
  }
  if (!/^\d{4,8}$/.test(pin)) {
    console.error("OWNER_PIN must be 4-8 digits.");
    process.exit(1);
  }

  const restaurants = await db.restaurant.findMany({ select: { id: true, name: true, slug: true } });
  if (restaurants.length === 0) {
    console.error("No restaurants found. Aborting.");
    process.exit(1);
  }
  const restaurant = restaurants[0];
  console.log(`Using restaurant: ${restaurant.name} (${restaurant.slug})`);

  const existingOwners = await db.staff.findMany({
    where: { restaurantId: restaurant.id, role: "OWNER" },
    select: { id: true, name: true, active: true },
  });

  if (existingOwners.length > 0 && !force) {
    console.log(`\nOWNER(s) already exist in this restaurant:`);
    for (const o of existingOwners) console.log(`  - ${o.name} (id=${o.id}, active=${o.active})`);
    console.log(`\nNo changes made. Set FORCE=1 to add another owner.`);
    process.exit(0);
  }

  const hashedPin = await bcrypt.hash(pin, 10);
  const owner = await db.staff.create({
    data: {
      name,
      pin: hashedPin,
      role: "OWNER",
      restaurantId: restaurant.id,
      active: true,
    },
    select: { id: true, name: true, role: true },
  });

  console.log(`\nCreated OWNER: ${owner.name} (id=${owner.id})`);
  console.log(`Use PIN "${pin}" to unlock /dashboard.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
