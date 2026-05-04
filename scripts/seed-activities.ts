// One-shot seeder for the Activities category + 4 items.
// Idempotent: safe to re-run; uses upserts keyed on (restaurantId, slug).
//
// Usage:
//   npx tsx scripts/seed-activities.ts                  # default neom-dahab
//   RESTAURANT_SLUG=foo-cafe npx tsx scripts/seed-activities.ts

import "dotenv/config";
import { db } from "../src/lib/db";

const slug = process.env.RESTAURANT_SLUG || "neom-dahab";

async function main() {
  const restaurant = await db.restaurant.findUnique({ where: { slug } });
  if (!restaurant) {
    console.error(`Restaurant '${slug}' not found.`);
    process.exit(1);
  }

  const category = await db.category.upsert({
    where: { restaurantId_slug: { restaurantId: restaurant.id, slug: "activities" } },
    create: {
      restaurantId: restaurant.id,
      slug: "activities",
      name: "Activities",
      nameAr: "أنشطة",
      icon: "🏖️",
      station: "ACTIVITY",
      sortOrder: 100,
    },
    update: { station: "ACTIVITY" },
  });

  const items = [
    { name: "Pool Ticket",    nameAr: "تذكرة مسبح",   price: 300,  pricePerHour: null,
      desc: "Daily pool access. Single ticket — flat fee, no timer." },
    { name: "Kayak",          nameAr: "كاياك",        price: 500,  pricePerHour: 500,
      desc: "Per-hour kayak hire. Billed prorated on return." },
    { name: "Board",          nameAr: "لوح",          price: 500,  pricePerHour: 500,
      desc: "Per-hour board hire. Billed prorated on return." },
    { name: "Massage (1 hr)", nameAr: "مساج (ساعة)",  price: 1800, pricePerHour: 1800,
      desc: "Massage session. Per-hour rate; staff stops the timer at the end." },
  ];

  for (const it of items) {
    const existing = await db.menuItem.findFirst({
      where: { categoryId: category.id, name: it.name },
      select: { id: true },
    });
    if (existing) {
      await db.menuItem.update({
        where: { id: existing.id },
        data: {
          nameAr: it.nameAr,
          description: it.desc,
          price: it.price,
          pricePerHour: it.pricePerHour,
          available: true,
        },
      });
    } else {
      await db.menuItem.create({
        data: {
          categoryId: category.id,
          name: it.name,
          nameAr: it.nameAr,
          description: it.desc,
          price: it.price,
          pricePerHour: it.pricePerHour,
          available: true,
        },
      });
    }
  }

  console.log(`Seeded Activities category + ${items.length} items for ${slug}.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
