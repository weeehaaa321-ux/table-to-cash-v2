import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });

async function main() {
  console.log("Seeding database...");

  // ─── Restaurant ──────────────────────────────
  const restaurant = await db.restaurant.upsert({
    where: { slug: "blue-hole-kitchen" },
    update: { name: "Neom Dahab" },
    create: {
      name: "Neom Dahab",
      slug: "blue-hole-kitchen",
      currency: "EGP",
      timezone: "Africa/Cairo",
    },
  });

  console.log(`Restaurant: ${restaurant.name} (${restaurant.id})`);

  // ─── Tables ──────────────────────────────────
  for (let i = 1; i <= 14; i++) {
    await db.table.upsert({
      where: {
        restaurantId_number: {
          restaurantId: restaurant.id,
          number: i,
        },
      },
      update: {},
      create: {
        number: i,
        label: `Table ${i}`,
        restaurantId: restaurant.id,
      },
    });
  }

  console.log("14 tables created");

  // ─── Categories ──────────────────────────────
  const categories = [
    { name: "Starters", nameAr: "المقبلات", nameRu: "Закуски", slug: "starters", sortOrder: 1, icon: "🥗" },
    { name: "Mains", nameAr: "الأطباق الرئيسية", nameRu: "Основные блюда", slug: "mains", sortOrder: 2, icon: "🍽️" },
    { name: "Drinks", nameAr: "المشروبات", nameRu: "Напитки", slug: "drinks", sortOrder: 3, icon: "🍹" },
    { name: "Desserts", nameAr: "الحلويات", nameRu: "Десерты", slug: "desserts", sortOrder: 4, icon: "🍰" },
  ];

  const catMap: Record<string, string> = {};

  for (const cat of categories) {
    const created = await db.category.upsert({
      where: {
        restaurantId_slug: {
          restaurantId: restaurant.id,
          slug: cat.slug,
        },
      },
      update: { name: cat.name, nameAr: cat.nameAr, nameRu: cat.nameRu, sortOrder: cat.sortOrder, icon: cat.icon },
      create: { ...cat, restaurantId: restaurant.id },
    });
    catMap[cat.slug] = created.id;
  }

  console.log("4 categories created");

  // ─── Menu Items ──────────────────────────────
  const items = [
    // Starters
    {
      name: "Hummus Trio", description: "Classic, roasted red pepper & herb — with warm pita",
      price: 85, image: "https://images.unsplash.com/photo-1577805947697-89e18249d767?w=600&h=450&fit=crop&q=80",
      bestSeller: true, highMargin: true, calories: 320, prepTime: 5,
      sortOrder: 1, categorySlug: "starters",
      pairsWith: ["d1", "d3"], tags: ["appetizer", "sharing", "vegan"],
      addOns: [{ name: "Extra Pita", price: 15 }, { name: "Falafel Bites", price: 25 }],
    },
    {
      name: "Grilled Halloumi", description: "Golden-crusted with honey drizzle & fresh mint",
      price: 95, image: "https://images.unsplash.com/photo-1497534446932-c925b458314e?w=600&h=450&fit=crop&q=80",
      bestSeller: false, highMargin: true, calories: 280, prepTime: 8,
      sortOrder: 2, categorySlug: "starters",
      pairsWith: ["d2"], tags: ["appetizer", "cheese"],
      addOns: [{ name: "Add Rocket Salad", price: 20 }],
    },
    {
      name: "Calamari Fritti", description: "Crispy fried squid with lemon aioli",
      price: 110, image: "https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?w=600&h=450&fit=crop&q=80",
      bestSeller: true, highMargin: false, calories: 380, prepTime: 10,
      sortOrder: 3, categorySlug: "starters",
      pairsWith: ["d1", "d4"], tags: ["seafood", "appetizer", "sharing"],
      addOns: [],
    },
    // Mains
    {
      name: "Grilled Sea Bass", description: "Whole fish, herb butter, roasted vegetables & tahini",
      price: 245, image: "https://images.unsplash.com/photo-1534604973900-c43ab4c2e0ab?w=600&h=450&fit=crop&q=80",
      bestSeller: true, highMargin: true, calories: 520, prepTime: 20,
      sortOrder: 1, categorySlug: "mains",
      pairsWith: ["d1", "d4"], tags: ["seafood", "fish", "main"],
      addOns: [{ name: "Side Salad", price: 35 }, { name: "Extra Rice", price: 25 }],
    },
    {
      name: "Lamb Kofta Platter", description: "Spiced lamb skewers, saffron rice, grilled veg & tzatziki",
      price: 195, image: "https://images.unsplash.com/photo-1529006557810-274b9b2fc783?w=600&h=450&fit=crop&q=80",
      bestSeller: false, highMargin: true, calories: 680, prepTime: 18,
      sortOrder: 2, categorySlug: "mains",
      pairsWith: ["d2", "d3"], tags: ["meat", "main"],
      addOns: [{ name: "Extra Skewer", price: 55 }],
    },
    {
      name: "Shrimp Pasta", description: "Tiger prawns, cherry tomatoes, garlic & chili linguine",
      price: 185, image: "https://images.unsplash.com/photo-1563379926898-05f4575a45d8?w=600&h=450&fit=crop&q=80",
      bestSeller: true, highMargin: false, calories: 560, prepTime: 15,
      sortOrder: 3, categorySlug: "mains",
      pairsWith: ["d1"], tags: ["seafood", "shrimp", "pasta", "main"],
      addOns: [{ name: "Extra Prawns", price: 65 }, { name: "Garlic Bread", price: 30 }],
    },
    {
      name: "Beach Burger", description: "Wagyu beef, aged cheddar, caramelized onion, truffle aioli",
      price: 165, image: "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=600&h=450&fit=crop&q=80",
      bestSeller: false, highMargin: true, calories: 780, prepTime: 15,
      sortOrder: 4, categorySlug: "mains",
      pairsWith: ["d2", "d5"], tags: ["meat", "burger", "main"],
      addOns: [{ name: "Add Bacon", price: 25 }, { name: "Sweet Potato Fries", price: 35 }],
    },
    // Drinks
    {
      name: "Chilled White Wine", description: "Crisp Sauvignon Blanc — glass",
      price: 95, image: "https://images.unsplash.com/photo-1474722883778-792e7990302f?w=600&h=450&fit=crop&q=80",
      bestSeller: true, highMargin: true, calories: 120, prepTime: 1,
      sortOrder: 1, categorySlug: "drinks",
      pairsWith: ["m1", "m3", "s3"], tags: ["white-wine", "wine", "drink", "premium-drink"],
      addOns: [],
    },
    {
      name: "Craft Beer", description: "Local Egyptian amber ale, ice cold",
      price: 75, image: "https://images.unsplash.com/photo-1535958636474-b021ee887b13?w=600&h=450&fit=crop&q=80",
      bestSeller: false, highMargin: true, calories: 180, prepTime: 1,
      sortOrder: 2, categorySlug: "drinks",
      pairsWith: ["m2", "m4"], tags: ["beer", "drink"],
      addOns: [],
    },
    {
      name: "Sunset Cocktail", description: "Mango, passion fruit, rum & a splash of grenadine",
      price: 120, image: "https://images.unsplash.com/photo-1514362545857-3bc16c4c7d1b?w=600&h=450&fit=crop&q=80",
      bestSeller: true, highMargin: true, calories: 220, prepTime: 3,
      sortOrder: 3, categorySlug: "drinks",
      pairsWith: ["s1"], tags: ["cocktail", "drink", "premium-drink"],
      addOns: [{ name: "Make it Double", price: 45 }],
    },
    {
      name: "Fresh Lemonade", description: "Hand-squeezed with mint & a touch of honey",
      price: 45, image: "https://images.unsplash.com/photo-1523677011781-c91d1bbe2f9e?w=600&h=450&fit=crop&q=80",
      bestSeller: false, highMargin: true, calories: 90, prepTime: 2,
      sortOrder: 4, categorySlug: "drinks",
      pairsWith: ["m1", "s3"], tags: ["juice", "drink"],
      addOns: [{ name: "Add Ginger", price: 10 }],
    },
    {
      name: "Espresso", description: "Rich Italian roast, smooth & bold",
      price: 35, image: "https://images.unsplash.com/photo-1510707577719-ae7c14805e3a?w=600&h=450&fit=crop&q=80",
      bestSeller: false, highMargin: true, calories: 5, prepTime: 2,
      sortOrder: 5, categorySlug: "drinks",
      pairsWith: ["ds1", "ds2"], tags: ["coffee", "espresso", "drink"],
      addOns: [{ name: "Oat Milk", price: 15 }],
    },
    // Desserts
    {
      name: "Kunafa", description: "Crispy shredded pastry, melted cheese, rose syrup & pistachios",
      price: 75, image: "https://images.unsplash.com/photo-1567171466295-4afa63d45416?w=600&h=450&fit=crop&q=80",
      bestSeller: true, highMargin: true, calories: 420, prepTime: 8,
      sortOrder: 1, categorySlug: "desserts",
      pairsWith: ["d5"], tags: ["dessert", "pastry"],
      addOns: [{ name: "Add Ice Cream", price: 25 }],
    },
    {
      name: "Chocolate Lava Cake", description: "Warm dark chocolate center, vanilla ice cream, sea salt",
      price: 85, image: "https://images.unsplash.com/photo-1624353365286-3f8d62daad51?w=600&h=450&fit=crop&q=80",
      bestSeller: true, highMargin: true, calories: 480, prepTime: 12,
      sortOrder: 2, categorySlug: "desserts",
      pairsWith: ["d5"], tags: ["dessert", "cake", "chocolate"],
      addOns: [],
    },
  ];

  for (const item of items) {
    const { addOns, categorySlug, ...itemData } = item;
    const categoryId = catMap[categorySlug];
    const itemId = `seed-${itemData.name.toLowerCase().replace(/\s+/g, "-")}`;

    // Delete existing addOns to prevent duplicates on re-seed
    await db.addOn.deleteMany({ where: { menuItemId: itemId } }).catch(() => {});

    const created = await db.menuItem.upsert({
      where: { id: itemId },
      update: {
        ...itemData,
        categoryId,
        addOns: {
          create: addOns.map((a) => ({
            name: a.name,
            price: a.price,
          })),
        },
      },
      create: {
        id: itemId,
        ...itemData,
        categoryId,
        addOns: {
          create: addOns.map((a) => ({
            name: a.name,
            price: a.price,
          })),
        },
      },
    });

    console.log(`  ${created.name}`);
  }

  console.log(`${items.length} menu items created`);
  console.log("\nSeed complete!");
  console.log(`\nRestaurant ID: ${restaurant.id}`);
  console.log(`Slug: ${restaurant.slug}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
