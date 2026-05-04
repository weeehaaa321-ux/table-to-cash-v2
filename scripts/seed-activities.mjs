// One-shot seeder for the Activities category + 4 items.
// Idempotent: safe to re-run; uses upserts keyed on (restaurantId, slug).
//
// Usage:
//   node scripts/seed-activities.mjs                  # default neom-dahab
//   RESTAURANT_SLUG=foo-cafe node scripts/seed-activities.mjs

import { PrismaClient } from "../src/generated/prisma/client.js";

const slug = process.env.RESTAURANT_SLUG || "neom-dahab";
const db = new PrismaClient();

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
      sortOrder: 100, // Sit to the right of food/drinks in default tile order.
    },
    update: { station: "ACTIVITY" },
  });

  const items = [
    { slug: "pool-ticket",    name: "Pool Ticket",     nameAr: "تذكرة مسبح",   price: 300,  pricePerHour: null,
      desc: "Daily pool access. Single ticket — flat fee, no timer." },
    { slug: "kayak",          name: "Kayak",           nameAr: "كاياك",        price: 500,  pricePerHour: 500,
      desc: "Per-hour kayak hire. Billed prorated on return." },
    { slug: "board",          name: "Board",           nameAr: "لوح",          price: 500,  pricePerHour: 500,
      desc: "Per-hour board hire. Billed prorated on return." },
    { slug: "massage-1h",     name: "Massage (1 hr)",  nameAr: "مساج (ساعة)",  price: 1800, pricePerHour: 1800,
      desc: "Massage session. Per-hour rate; staff stops the timer at the end." },
  ];

  for (const it of items) {
    // We don't have a (categoryId, name) unique constraint on MenuItem
    // so search by name within this category and update; create if absent.
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
