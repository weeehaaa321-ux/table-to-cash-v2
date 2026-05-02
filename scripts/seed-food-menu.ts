import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const db = new PrismaClient({ adapter });

const u = (id: string, w = 600, h = 450) =>
  `https://images.unsplash.com/photo-${id}?w=${w}&h=${h}&fit=crop&q=80`;

type Cat = {
  name: string; slug: string; sortOrder: number;
  icon: string; station: "KITCHEN" | "BAR";
};

type Item = {
  name: string; description?: string; price: number;
  image: string; categorySlug: string; sortOrder: number;
  prepTime?: number; bestSeller?: boolean;
};

// Numbers must agree with 20260502130000_smart_category_sort.
const categories: Cat[] = [
  { name: "Salads", slug: "salads", sortOrder: 40, icon: "🥗", station: "KITCHEN" },
  { name: "Soups", slug: "soups", sortOrder: 50, icon: "🍲", station: "KITCHEN" },
  { name: "Starters & Snacks", slug: "starters", sortOrder: 60, icon: "🍽️", station: "KITCHEN" },
  { name: "Main Course", slug: "main-course", sortOrder: 70, icon: "🥩", station: "KITCHEN" },
  { name: "Italian Pasta", slug: "pasta", sortOrder: 80, icon: "🍝", station: "KITCHEN" },
  { name: "Italian Pizza", slug: "pizza", sortOrder: 90, icon: "🍕", station: "KITCHEN" },
  { name: "Burgers", slug: "burgers", sortOrder: 100, icon: "🍔", station: "KITCHEN" },
  { name: "Sandwiches", slug: "sandwiches", sortOrder: 110, icon: "🥪", station: "KITCHEN" },
];

const items: Item[] = [
  // ─── Salads ───────────────────────────────────────
  { name: "Green Salad", description: "Fresh mixed greens with a light vinaigrette.", price: 100, image: u("1512621776951-a57141f2eefd"), categorySlug: "salads", sortOrder: 1, prepTime: 5 },
  { name: "Greek Salad", description: "Crisp vegetables, olives, and feta cheese dressed with olive oil.", price: 200, image: u("1540189549336-e6e99c3679fe"), categorySlug: "salads", sortOrder: 2, prepTime: 6, bestSeller: true },
  { name: "Caesar Salad", description: "Romaine lettuce, parmesan, croutons, and Caesar dressing.", price: 160, image: u("1550304943-4f24f54ddde9"), categorySlug: "salads", sortOrder: 3, prepTime: 6 },
  { name: "Caesar Salad with Chicken", description: "Romaine lettuce, parmesan, croutons, Caesar dressing with grilled chicken.", price: 250, image: u("1580013759032-198dd026bfc4"), categorySlug: "salads", sortOrder: 4, prepTime: 8, bestSeller: true },
  { name: "Avocado Salad", description: "Sliced avocado with mixed greens and a citrus dressing.", price: 220, image: u("1541519227354-08fa5d50c44d"), categorySlug: "salads", sortOrder: 5, prepTime: 6 },
  { name: "Tomato Mozzarella Salad", description: "Layers of tomatoes and mozzarella drizzled with balsamic glaze.", price: 170, image: u("1592417817098-8fd3d9eb14a5"), categorySlug: "salads", sortOrder: 6, prepTime: 5 },
  { name: "Tuna Salad", description: "Fresh greens, tuna, cherry tomatoes, olives, and a light dressing.", price: 250, image: u("1565958011703-44f9829ba187"), categorySlug: "salads", sortOrder: 7, prepTime: 7 },
  { name: "Fruit Salad", description: "A refreshing mix of seasonal fresh fruits.", price: 140, image: u("1564093497595-593b96d80f64"), categorySlug: "salads", sortOrder: 8, prepTime: 4 },

  // ─── Starters & Snacks ────────────────────────────
  { name: "Bruschetta", description: "Grilled bread topped with fresh tomato and basil.", price: 100, image: u("1572695157366-5e585ab2b69f"), categorySlug: "starters", sortOrder: 1, prepTime: 6 },
  { name: "Marinated Olives", description: "A selection of marinated olives.", price: 100, image: u("1593001874328-fafe0ba92e46"), categorySlug: "starters", sortOrder: 2, prepTime: 2 },
  { name: "Potato Wedges", description: "Seasoned and crispy potato wedges served with dipping sauce.", price: 100, image: u("1573080496219-bb080dd4f877"), categorySlug: "starters", sortOrder: 3, prepTime: 10, bestSeller: true },
  { name: "Chicken Wings (Spicy or BBQ)", description: "Spicy or BBQ chicken wings served with a side of ranch.", price: 140, image: u("1608039755401-742074f0dce0"), categorySlug: "starters", sortOrder: 4, prepTime: 15, bestSeller: true },
  { name: "Vegetable Spring Rolls", description: "Crispy rolls filled with mixed vegetables.", price: 120, image: u("1540648639573-8c848de23f0a"), categorySlug: "starters", sortOrder: 5, prepTime: 10 },
  { name: "Chicken Spring Rolls", description: "Crispy rolls filled with chicken, served with chili sauce.", price: 150, image: u("1540648639573-8c848de23f0a"), categorySlug: "starters", sortOrder: 6, prepTime: 10 },
  { name: "Cheese Bites", description: "Cheese pieces served with a tangy dip.", price: 145, image: u("1531749668029-2db88e4276c7"), categorySlug: "starters", sortOrder: 7, prepTime: 8 },
  { name: "French Fries", description: "Crispy golden fries, served with ketchup.", price: 70, image: u("1573080496219-bb080dd4f877"), categorySlug: "starters", sortOrder: 8, prepTime: 8 },
  { name: "French Fries with Cheese", description: "Crispy golden fries topped with cheese sauce.", price: 90, image: u("1585109649979-4a72e4d58903"), categorySlug: "starters", sortOrder: 9, prepTime: 9 },
  { name: "Chicken Strips", description: "Crispy breaded chicken strips served with dipping sauce.", price: 210, image: u("1562967914-01efa7e87832"), categorySlug: "starters", sortOrder: 10, prepTime: 12 },
  { name: "Mixed Cheese", description: "A selection of premium cheeses served with bread.", price: 190, image: u("1452195100486-9cc805987862"), categorySlug: "starters", sortOrder: 11, prepTime: 5 },

  // ─── Soups ────────────────────────────────────────
  { name: "Chicken Mushroom Soup", description: "Tender chicken pieces with mushrooms in a creamy broth.", price: 250, image: u("1547592166-23ac45744acd"), categorySlug: "soups", sortOrder: 1, prepTime: 15 },
  { name: "Mushroom Soup", description: "Mushrooms in a creamy broth.", price: 180, image: u("1547592166-23ac45744acd"), categorySlug: "soups", sortOrder: 2, prepTime: 12 },
  { name: "Lentil Soup", description: "Traditional lentil soup seasoned with aromatic spices.", price: 100, image: u("1603105037880-880cd4ad7eee"), categorySlug: "soups", sortOrder: 3, prepTime: 10, bestSeller: true },
  { name: "Tomato Soup", description: "Rich and creamy tomato soup with a hint of basil.", price: 140, image: u("1547592166-23ac45744acd"), categorySlug: "soups", sortOrder: 4, prepTime: 10 },
  { name: "Vegetable Soup", description: "A hearty mix of seasonal vegetables in a light broth.", price: 140, image: u("1603105037880-880cd4ad7eee"), categorySlug: "soups", sortOrder: 5, prepTime: 12 },
  { name: "Seafood Soup", description: "A rich seafood broth with shrimp, calamari, and fish.", price: 400, image: u("1594756202469-9488f64ed82a"), categorySlug: "soups", sortOrder: 6, prepTime: 18 },

  // ─── Italian Pasta ────────────────────────────────
  { name: "Lasagna Verde", description: "Spinach lasagna topped with béchamel and cheese.", price: 180, image: u("1574894709920-11b28e7367e3"), categorySlug: "pasta", sortOrder: 1, prepTime: 20 },
  { name: "Lasagna Bolognese", description: "Beef lasagna topped with béchamel and cheese.", price: 450, image: u("1619895092538-128341789043"), categorySlug: "pasta", sortOrder: 2, prepTime: 22, bestSeller: true },
  { name: "Alfredo Pasta", description: "Creamy white sauce pasta with chicken or mushrooms.", price: 300, image: u("1645112411341-6c4fd023714a"), categorySlug: "pasta", sortOrder: 3, prepTime: 15, bestSeller: true },
  { name: "Tuna Pasta", description: "Al dente pasta with a rich tuna sauce, garlic, and herbs, topped with parmesan.", price: 250, image: u("1563379926898-05f4575a45d8"), categorySlug: "pasta", sortOrder: 4, prepTime: 14 },
  { name: "Seafood Pasta", description: "Shrimp, calamari, and mussels in a creamy or tomato sauce over pasta.", price: 400, image: u("1563379926898-05f4575a45d8"), categorySlug: "pasta", sortOrder: 5, prepTime: 18 },
  { name: "Carbonara", description: "Classic Italian pasta with crispy beef bacon, egg yolk, parmesan, and creamy sauce.", price: 270, image: u("1612874742237-6526221588e3"), categorySlug: "pasta", sortOrder: 6, prepTime: 15 },
  { name: "Salmon Pasta", description: "Salmon with white sauce over pasta.", price: 400, image: u("1563379926898-05f4575a45d8"), categorySlug: "pasta", sortOrder: 7, prepTime: 18 },
  { name: "Neapolitan Pasta", description: "Traditional Italian pasta with a rich tomato sauce, garlic, and basil.", price: 160, image: u("1598866594171-623ce93aa7d0"), categorySlug: "pasta", sortOrder: 8, prepTime: 12 },
  { name: "Bolognese", description: "Classic pasta with slow-cooked minced beef in a hearty tomato sauce, topped with parmesan.", price: 320, image: u("1621996346565-e3dbc646d9a9"), categorySlug: "pasta", sortOrder: 9, prepTime: 15, bestSeller: true },
  { name: "Chicken Red Sauce Pasta", description: "Tender chicken pieces tossed with pasta in a flavorful red sauce with herbs.", price: 280, image: u("1598866594171-623ce93aa7d0"), categorySlug: "pasta", sortOrder: 10, prepTime: 15 },
  { name: "Seafood Lasagna", description: "Seafood lasagna with tomato sauce, topped with béchamel and mozzarella.", price: 450, image: u("1619895092538-128341789043"), categorySlug: "pasta", sortOrder: 11, prepTime: 22 },
  { name: "Neapolitan with Vegetables", description: "Neapolitan pasta with fresh seasonal vegetables in a light tomato sauce.", price: 170, image: u("1598866594171-623ce93aa7d0"), categorySlug: "pasta", sortOrder: 12, prepTime: 13 },
  { name: "Penne Arrabbiata", description: "Penne pasta in a spicy tomato sauce.", price: 180, image: u("1598866594171-623ce93aa7d0"), categorySlug: "pasta", sortOrder: 13, prepTime: 12 },

  // ─── Burgers ──────────────────────────────────────
  { name: "Cheese Burger", description: "Juicy beef patty with melted cheddar, lettuce, tomato, and special sauce in a toasted bun.", price: 250, image: u("1568901346375-23c9450c58cd"), categorySlug: "burgers", sortOrder: 1, prepTime: 15, bestSeller: true },
  { name: "Caramelized Onion Burger", description: "Grilled beef with sweet caramelized onions, cheddar, and creamy sauce.", price: 230, image: u("1553979459-d2229ba7433b"), categorySlug: "burgers", sortOrder: 2, prepTime: 15 },
  { name: "Mushroom Burger", description: "Beef patty with sautéed mushrooms, melted cheese, and house sauce.", price: 250, image: u("1572802419224-296b0aeee15d"), categorySlug: "burgers", sortOrder: 3, prepTime: 15 },
  { name: "Beef Bacon Burger", description: "Grilled beef with crispy beef bacon, melted cheese, and fresh toppings.", price: 270, image: u("1594212699903-ec8a3eca50f5"), categorySlug: "burgers", sortOrder: 4, prepTime: 15 },
  { name: "Mozzarella Burger", description: "Crispy mozzarella atop a juicy beef patty with fresh lettuce, tomato, and house sauce.", price: 200, image: u("1568901346375-23c9450c58cd"), categorySlug: "burgers", sortOrder: 5, prepTime: 15 },
  { name: "Neom Burger", description: "Double beef patty with mozzarella, crispy bacon, sautéed mushrooms, and house sauce in brioche.", price: 350, image: u("1586816001966-305b35718a65"), categorySlug: "burgers", sortOrder: 6, prepTime: 18, bestSeller: true },

  // ─── Italian Pizza ────────────────────────────────
  { name: "BBQ Chicken Pizza", description: "Grilled chicken with smoky BBQ sauce, mozzarella, and onions.", price: 270, image: u("1565299624946-b28f40a0ae38"), categorySlug: "pizza", sortOrder: 1, prepTime: 18 },
  { name: "Chicken Pizza", description: "Classic pizza with grilled chicken, mozzarella, and tomato sauce.", price: 250, image: u("1565299624946-b28f40a0ae38"), categorySlug: "pizza", sortOrder: 2, prepTime: 18 },
  { name: "Margherita Pizza", description: "Traditional pizza with tomato sauce, mozzarella, and fresh basil.", price: 220, image: u("1574071318508-1cdbab80d002"), categorySlug: "pizza", sortOrder: 3, prepTime: 15, bestSeller: true },
  { name: "Mixed Cheese Pizza", description: "A blend of mozzarella, parmesan, and cheddar on tomato sauce.", price: 270, image: u("1513104890138-7c749659a591"), categorySlug: "pizza", sortOrder: 4, prepTime: 16 },
  { name: "Mixed Seafood Pizza", description: "A selection of seafood with mozzarella and a light garlic sauce.", price: 450, image: u("1565299624946-b28f40a0ae38"), categorySlug: "pizza", sortOrder: 5, prepTime: 20 },
  { name: "Ranch Chicken Pizza", description: "Grilled chicken with ranch sauce, mozzarella, and onions.", price: 300, image: u("1565299624946-b28f40a0ae38"), categorySlug: "pizza", sortOrder: 6, prepTime: 18 },
  { name: "Salami Pizza", description: "Slices of salami with tomato sauce and mozzarella cheese.", price: 250, image: u("1628840042765-356cda07504e"), categorySlug: "pizza", sortOrder: 7, prepTime: 15 },
  { name: "Tuna Pizza", description: "Tuna chunks with mozzarella, onions, and olives.", price: 280, image: u("1565299624946-b28f40a0ae38"), categorySlug: "pizza", sortOrder: 8, prepTime: 16 },
  { name: "Vegetable Pizza", description: "A mix of fresh vegetables with mozzarella and tomato sauce.", price: 200, image: u("1574071318508-1cdbab80d002"), categorySlug: "pizza", sortOrder: 9, prepTime: 15 },

  // ─── Sandwiches ───────────────────────────────────
  { name: "Club Sandwich", description: "Triple-layered with turkey, cheese, lettuce, tomato, and mayo, served with fries.", price: 220, image: u("1528735612338-2140ea1d6e31"), categorySlug: "sandwiches", sortOrder: 1, prepTime: 12, bestSeller: true },
  { name: "Halloumi Cheese Sandwich", description: "Grilled halloumi with fresh vegetables and olive oil in toasted bread, served with fries.", price: 250, image: u("1528735612338-2140ea1d6e31"), categorySlug: "sandwiches", sortOrder: 2, prepTime: 10 },
  { name: "Turkey Sandwich", description: "Sliced turkey breast with cheese and greens.", price: 200, image: u("1528735612338-2140ea1d6e31"), categorySlug: "sandwiches", sortOrder: 3, prepTime: 8 },
  { name: "Quesadilla", description: "Chicken, vegetables, olives, avocado, cheese, Doritos.", price: 350, image: u("1618040996337-56904b7850b9"), categorySlug: "sandwiches", sortOrder: 4, prepTime: 12 },
  { name: "Burger Tacos", description: "Homemade burger, lettuce, olives, cheese, Texas sauce.", price: 250, image: u("1551504734-5ee1c4a1479b"), categorySlug: "sandwiches", sortOrder: 5, prepTime: 12 },
  { name: "Strips Tacos", description: "Chicken strips, lettuce, olives, cheese, ranch sauce.", price: 270, image: u("1551504734-5ee1c4a1479b"), categorySlug: "sandwiches", sortOrder: 6, prepTime: 12 },
  { name: "Shrimp Sandwich", description: "Grilled shrimp with lettuce, tartar sauce, and lemon, in a soft bun.", price: 400, image: u("1521305916504-4a1121188589"), categorySlug: "sandwiches", sortOrder: 7, prepTime: 14 },
  { name: "Smoked Salmon Sandwich", description: "Smoked salmon with cream cheese, capers, and fresh greens on toasted baguette.", price: 390, image: u("1521305916504-4a1121188589"), categorySlug: "sandwiches", sortOrder: 8, prepTime: 8 },
  { name: "Tuna Mayo Sandwich", description: "Tuna with creamy mayo, celery, and lemon in fresh bread.", price: 250, image: u("1528735612338-2140ea1d6e31"), categorySlug: "sandwiches", sortOrder: 9, prepTime: 8 },
  { name: "Hot Dog", description: "Grilled sausage with sautéed onions, mustard, and ketchup in a soft roll.", price: 180, image: u("1612392166886-d0367b4802b4"), categorySlug: "sandwiches", sortOrder: 10, prepTime: 8 },
  { name: "Salami Sandwich", description: "Salami slices with cheese and lettuce.", price: 200, image: u("1528735612338-2140ea1d6e31"), categorySlug: "sandwiches", sortOrder: 11, prepTime: 6 },
  { name: "Bacon Sandwich", description: "Crispy bacon with lettuce and tomato.", price: 200, image: u("1528735612338-2140ea1d6e31"), categorySlug: "sandwiches", sortOrder: 12, prepTime: 8 },
  { name: "Chicken Shawarma", description: "Grilled chicken slices with sauce, pickles, and vegetables in pita bread, served with fries.", price: 250, image: u("1529006557810-274b9b2fc783"), categorySlug: "sandwiches", sortOrder: 13, prepTime: 10, bestSeller: true },
  { name: "Chicken Pané", description: "Breaded chicken fillet with lettuce and mayo.", price: 250, image: u("1562967914-01efa7e87832"), categorySlug: "sandwiches", sortOrder: 14, prepTime: 12 },

  // ─── Main Course — Meat ───────────────────────────
  { name: "Beef Steak", description: "Grilled steak with sautéed vegetables and mashed potatoes. Choice of mushroom, pepper, or Roquefort sauce.", price: 800, image: u("1558030006-450675393462"), categorySlug: "main-course", sortOrder: 1, prepTime: 25, bestSeller: true },
  { name: "T-Bone Steak", description: "Grilled T-bone with sautéed vegetables and potato wedges. Choice of mushroom, pepper, or Roquefort sauce.", price: 900, image: u("1558030006-450675393462"), categorySlug: "main-course", sortOrder: 2, prepTime: 28 },
  { name: "Beef Piccata", description: "Tender beef slices in a rich mushroom sauce with sautéed vegetables and potato wedges.", price: 650, image: u("1544025162-d76694265947"), categorySlug: "main-course", sortOrder: 3, prepTime: 22 },
  { name: "Beef Stroganoff", description: "Strips of beef in a creamy sauce, served with rice and vegetables.", price: 650, image: u("1544025162-d76694265947"), categorySlug: "main-course", sortOrder: 4, prepTime: 20 },

  // ─── Main Course — Chicken ────────────────────────
  { name: "Grilled Chicken Fillet", description: "Served with grilled vegetables and salad.", price: 300, image: u("1532550907401-a500c9a57435"), categorySlug: "main-course", sortOrder: 5, prepTime: 18 },
  { name: "Lemon Chicken", description: "Chicken breast with a zesty lemon sauce, served with rice and sautéed vegetables.", price: 320, image: u("1532550907401-a500c9a57435"), categorySlug: "main-course", sortOrder: 6, prepTime: 18 },
  { name: "Chicken Curry", description: "Tender chicken in a rich curry sauce, served with rice and sautéed vegetables.", price: 350, image: u("1565557623262-b51c2513a641"), categorySlug: "main-course", sortOrder: 7, prepTime: 20 },
  { name: "Chicken with Mushroom Sauce", description: "Chicken breast in a creamy mushroom sauce, served with rice and sautéed vegetables.", price: 320, image: u("1532550907401-a500c9a57435"), categorySlug: "main-course", sortOrder: 8, prepTime: 18 },

  // ─── Main Course — Seafood ────────────────────────
  { name: "Butterfly Shrimp", description: "Shrimp served with melted butter sauce and a lemon wedge.", price: 950, image: u("1625943553852-781c6dd46060"), categorySlug: "main-course", sortOrder: 9, prepTime: 18 },
  { name: "Grilled Calamari", description: "Grilled calamari served with lemon and herbs.", price: 400, image: u("1599487488170-d11ec9c172f0"), categorySlug: "main-course", sortOrder: 10, prepTime: 15 },
  { name: "Salmon Steak", description: "Grilled salmon served with pesto sauce and mashed potato.", price: 1100, image: u("1519708227418-b869ee049717"), categorySlug: "main-course", sortOrder: 11, prepTime: 22, bestSeller: true },

  // ─── Main Course — Vegetarian ─────────────────────
  { name: "Vegetable Curry", description: "Mixed vegetables in a flavorful curry sauce, served with rice and salad.", price: 250, image: u("1565557623262-b51c2513a641"), categorySlug: "main-course", sortOrder: 12, prepTime: 18 },
  { name: "Spicy Moroccan Tagine", description: "Vegetables in tomato sauce, served with rice and salad.", price: 280, image: u("1511690743698-d9d18f7e20f1"), categorySlug: "main-course", sortOrder: 13, prepTime: 20 },
  { name: "Spinach Malfatti", description: "Spinach dumplings in tomato sauce with cheese and potatoes.", price: 320, image: u("1574894709920-11b28e7367e3"), categorySlug: "main-course", sortOrder: 14, prepTime: 18 },
];

async function main() {
  console.log("Adding food menu to Neom Dahab...\n");

  const restaurant = await db.restaurant.findFirst({
    where: { OR: [{ slug: "neom-dahab" }, { slug: "blue-hole-kitchen" }] },
  });
  if (!restaurant) throw new Error("Restaurant not found — run the main seed first");
  console.log(`Restaurant: ${restaurant.name} (${restaurant.slug})\n`);

  // ── Create / update categories ──
  const catMap: Record<string, string> = {};
  for (const cat of categories) {
    const created = await db.category.upsert({
      where: {
        restaurantId_slug: { restaurantId: restaurant.id, slug: cat.slug },
      },
      update: {
        name: cat.name,
        sortOrder: cat.sortOrder,
        icon: cat.icon,
        station: cat.station,
      },
      create: {
        name: cat.name,
        slug: cat.slug,
        sortOrder: cat.sortOrder,
        icon: cat.icon,
        station: cat.station,
        restaurantId: restaurant.id,
      },
    });
    catMap[cat.slug] = created.id;
    console.log(`  ✓ Category: ${cat.icon} ${cat.name}`);
  }
  console.log(`\n${categories.length} categories ready.\n`);

  // ── Create menu items (skip if name already exists in category) ──
  let created = 0;
  let skipped = 0;
  for (const item of items) {
    const categoryId = catMap[item.categorySlug];
    if (!categoryId) {
      console.error(`  ✗ No category for slug "${item.categorySlug}" — skipping ${item.name}`);
      continue;
    }

    const exists = await db.menuItem.findFirst({
      where: { categoryId, name: item.name },
    });
    if (exists) {
      skipped++;
      continue;
    }

    await db.menuItem.create({
      data: {
        name: item.name,
        description: item.description,
        price: item.price,
        image: item.image,
        sortOrder: item.sortOrder,
        prepTime: item.prepTime,
        bestSeller: item.bestSeller ?? false,
        categoryId,
      },
    });
    created++;
    console.log(`  ${item.name} — ${item.price} L.E`);
  }

  console.log(`\n${created} items created, ${skipped} already existed.`);
  console.log("Food menu seeding complete!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
