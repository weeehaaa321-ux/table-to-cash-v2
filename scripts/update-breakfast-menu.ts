/**
 * One-shot menu update: rewrites the Breakfast Platters, Chef's Special,
 * and Egg Dishes categories to the new spec.
 *
 * Usage:
 *   npx tsx scripts/update-breakfast-menu.ts            # dry run, prints diff
 *   npx tsx scripts/update-breakfast-menu.ts --apply    # actually write
 *
 * Resolves the target restaurant from NEXT_PUBLIC_RESTAURANT_SLUG (defaults
 * to "neom-dahab"). Connects via the standard Prisma client, so the same
 * env that the dashboard's menu-admin endpoint uses applies — point
 * DIRECT_URL (or DATABASE_URL) at prod to update prod.
 *
 * Strategy:
 *   • Match existing items by exact name within a category. Preserves
 *     menuItem.id so historical Order references stay intact.
 *   • Update name/price/description/sortOrder on matches that need it.
 *   • Create rows for items in the new spec that don't exist yet.
 *   • For items in the category that aren't in the new spec: hard-delete
 *     when there's no order history, otherwise mark available=false (same
 *     soft-delete fallback the menu-admin DELETE route uses).
 *   • Fix sortOrder so the new menu's row order is reflected on guest UI.
 *
 * Idempotent: re-running after a successful apply is a no-op (or surfaces
 * exactly the diff still pending).
 */

import "dotenv/config";
import { db } from "../src/lib/db";

type Spec = {
  name: string;
  nameAr?: string | null;
  price: number;
  description?: string | null;
  // Optional rename: when an existing row goes by a different name today
  // but maps to this spec. Keyed by the OLD name. Lets us keep the row
  // (and its order history) while renaming on display.
  matchOldName?: string;
};

const BREAKFAST: Spec[] = [
  { name: "English Breakfast", nameAr: "فطور إنجليزي", price: 340,
    description: "Sausage, mushrooms, bacon, potato, toast, butter, choice of eggs" },
  { name: "French Toast", nameAr: "فرنش توست", price: 340,
    description: "2 special toast, mushrooms, sausage, fruit, choice of eggs" },
  { name: "Meat Lovers", nameAr: "محبي اللحم", price: 360,
    description: "2 Sausages, 2 Bacon, 2 Turkey, Mushrooms, Potatoes Jam, Butter, 2 Toast" },
  { name: "Neom Breakfast", nameAr: "فطور نيوم", price: 250,
    description: "Muesli, milk, yogurt, cream, fruit, honey, toast" },
  { name: "Turkey Breakfast", nameAr: "فطور تركي", price: 280,
    description: "Turkey, cheddar cheese, salami, jam, butter, toast",
    matchOldName: "Turkish Breakfast" },
  { name: "Oriental Breakfast", nameAr: "فطور شرقي", price: 220,
    description: "Beans, falafel, tomato cheese, potato, boiled eggs, salad" },
  { name: "Croissant", nameAr: "كرواسون", price: 130,
    description: null, matchOldName: "(Just in Neom) Croissant" },
  { name: "Croissant with Filling", nameAr: "كرواسون بالحشو", price: 200,
    description: "Butter, Jam, Cheese, Turkey, or Chocolate" },
  { name: "Smoked Salmon Croissant", nameAr: "كرواسون السلمون المدخّن", price: 300,
    description: "Cream cheese, smoked salmon, capers, onions" },
];

const CHEFS_SPECIAL: Spec[] = [
  { name: "Avocado & Creamy Cheese Toast", nameAr: "توست أفوكادو وجبنة كريمي", price: 250 },
  { name: "Sweet French Croissant (Neom Specialty)", nameAr: "كرواسون فرنسي حلو (تخصصية نيوم)", price: 250 },
  { name: "Cheesy Toast", nameAr: "توست بالجبنة", price: 230 },
  { name: "Croque Madame", nameAr: "كروك مدام", price: 280 },
  { name: "Croque Monsieur", nameAr: "كروك مسيو", price: 300 },
  { name: "Egg in a Hole", nameAr: "بيضة في الخبز", price: 160 },
];

const EGGS: Spec[] = [
  { name: "Bacon Eggs", nameAr: "بيض بالبيكون", price: 200,
    matchOldName: "Bacon & Eggs" },
  { name: "Vegetable Omelet", nameAr: "أومليت خضار", price: 200 },
  { name: "Spinach Omelet", nameAr: "أومليت سبانخ", price: 200 },
  { name: "Meat Lovers", nameAr: "محبي اللحم", price: 250 },
  { name: "Cheese Omelet", nameAr: "أومليت جبنة", price: 170 },
  { name: "Three Eggs of Your Choice", nameAr: "٣ بيضات باختيارك", price: 170,
    description: "Scrambled, sunny side, or omelet" },
];

const CATEGORY_PLAN: { slug: string; label: string; items: Spec[] }[] = [
  { slug: "breakfast", label: "Breakfast Platters", items: BREAKFAST },
  { slug: "chefs-special", label: "Chef's Special", items: CHEFS_SPECIAL },
  { slug: "eggs", label: "Egg Dishes", items: EGGS },
];

type Action =
  | { kind: "create"; categorySlug: string; spec: Spec; sortOrder: number }
  | { kind: "update"; categorySlug: string; itemId: string; oldName: string; spec: Spec; sortOrder: number; changes: string[] }
  | { kind: "noop"; categorySlug: string; itemId: string; name: string }
  | { kind: "hard-delete"; categorySlug: string; itemId: string; name: string }
  | { kind: "deactivate"; categorySlug: string; itemId: string; name: string; orderRefs: number };

async function plan(restaurantId: string): Promise<Action[]> {
  const actions: Action[] = [];

  for (const cat of CATEGORY_PLAN) {
    const category = await db.category.findFirst({
      where: { restaurantId, slug: cat.slug },
      include: { items: true },
    });
    if (!category) {
      console.error(`Category "${cat.slug}" not found for restaurant ${restaurantId} — skipping.`);
      continue;
    }

    const existing = category.items.slice();
    const consumed = new Set<string>();

    for (let idx = 0; idx < cat.items.length; idx++) {
      const spec = cat.items[idx];
      const sortOrder = idx + 1;
      const matchName = spec.matchOldName ?? spec.name;
      const match = existing.find(
        (i) => !consumed.has(i.id) && i.name === matchName,
      );

      if (!match) {
        actions.push({ kind: "create", categorySlug: cat.slug, spec, sortOrder });
        continue;
      }
      consumed.add(match.id);

      const changes: string[] = [];
      if (match.name !== spec.name) changes.push(`name: "${match.name}" → "${spec.name}"`);
      if (Number(match.price) !== spec.price) changes.push(`price: ${Number(match.price)} → ${spec.price}`);
      const newDesc = spec.description ?? null;
      if ((match.description ?? null) !== newDesc) {
        changes.push(`desc: ${match.description ? `"${match.description}"` : "null"} → ${newDesc ? `"${newDesc}"` : "null"}`);
      }
      const newAr = spec.nameAr ?? null;
      if ((match.nameAr ?? null) !== newAr && newAr !== null) {
        changes.push(`nameAr: ${match.nameAr ? `"${match.nameAr}"` : "null"} → "${newAr}"`);
      }
      if (match.sortOrder !== sortOrder) changes.push(`sortOrder: ${match.sortOrder} → ${sortOrder}`);
      if (!match.available) changes.push(`available: false → true`);

      if (changes.length === 0) {
        actions.push({ kind: "noop", categorySlug: cat.slug, itemId: match.id, name: match.name });
      } else {
        actions.push({
          kind: "update",
          categorySlug: cat.slug,
          itemId: match.id,
          oldName: match.name,
          spec,
          sortOrder,
          changes,
        });
      }
    }

    // Anything in the category that wasn't matched is obsolete per the
    // user's spec ("the new menu is the only items in the breakfast
    // categories"). Hard-delete when no order history; deactivate
    // otherwise (mirrors the menu-admin DELETE route).
    for (const obsolete of existing) {
      if (consumed.has(obsolete.id)) continue;
      const orderRefs = await db.orderItem.count({ where: { menuItemId: obsolete.id } });
      if (orderRefs === 0) {
        actions.push({ kind: "hard-delete", categorySlug: cat.slug, itemId: obsolete.id, name: obsolete.name });
      } else {
        actions.push({ kind: "deactivate", categorySlug: cat.slug, itemId: obsolete.id, name: obsolete.name, orderRefs });
      }
    }
  }

  return actions;
}

async function apply(actions: Action[]) {
  for (const a of actions) {
    switch (a.kind) {
      case "noop":
        continue;
      case "create":
        await db.category.update({
          where: {
            id: (await db.category.findFirstOrThrow({
              where: { slug: a.categorySlug },
              select: { id: true },
            })).id,
          },
          data: {
            items: {
              create: {
                name: a.spec.name,
                nameAr: a.spec.nameAr ?? null,
                price: a.spec.price,
                description: a.spec.description ?? null,
                sortOrder: a.sortOrder,
                available: true,
              },
            },
          },
        });
        break;
      case "update":
        await db.menuItem.update({
          where: { id: a.itemId },
          data: {
            name: a.spec.name,
            price: a.spec.price,
            description: a.spec.description ?? null,
            ...(a.spec.nameAr ? { nameAr: a.spec.nameAr } : {}),
            sortOrder: a.sortOrder,
            available: true,
          },
        });
        break;
      case "hard-delete":
        await db.addOn.deleteMany({ where: { menuItemId: a.itemId } });
        await db.menuItem.delete({ where: { id: a.itemId } });
        break;
      case "deactivate":
        await db.menuItem.update({
          where: { id: a.itemId },
          data: { available: false },
        });
        break;
    }
  }
}

function printPlan(actions: Action[], applyMode: boolean) {
  const grouped = new Map<string, Action[]>();
  for (const a of actions) {
    const arr = grouped.get(a.categorySlug) ?? [];
    arr.push(a);
    grouped.set(a.categorySlug, arr);
  }

  let creates = 0, updates = 0, deletes = 0, deactivates = 0, noops = 0;

  for (const cat of CATEGORY_PLAN) {
    const acts = grouped.get(cat.slug) ?? [];
    if (acts.length === 0) continue;
    console.log(`\n── ${cat.label} (${cat.slug}) ─────────────────────────────`);
    for (const a of acts) {
      switch (a.kind) {
        case "create":
          console.log(`  + CREATE  "${a.spec.name}"  ${a.spec.price} EGP`);
          creates++;
          break;
        case "update":
          console.log(`  ~ UPDATE  "${a.oldName}"`);
          for (const c of a.changes) console.log(`              ${c}`);
          updates++;
          break;
        case "noop":
          console.log(`  · KEEP    "${a.name}"`);
          noops++;
          break;
        case "hard-delete":
          console.log(`  - DELETE  "${a.name}"  (no order history)`);
          deletes++;
          break;
        case "deactivate":
          console.log(`  - HIDE    "${a.name}"  (kept inactive — ${a.orderRefs} order refs)`);
          deactivates++;
          break;
      }
    }
  }

  console.log(`\nSummary:  +${creates} create  ~${updates} update  -${deletes} delete  -${deactivates} hide  ·${noops} noop`);
  console.log(applyMode ? "\n→ Mode: APPLY (changes have been written)\n" : "\n→ Mode: DRY-RUN. Re-run with --apply to write.\n");
}

async function main() {
  const applyMode = process.argv.includes("--apply");
  const slug = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";

  const restaurant = await db.restaurant.findUnique({
    where: { slug },
    select: { id: true, name: true },
  });
  if (!restaurant) {
    console.error(`Restaurant slug "${slug}" not found.`);
    process.exit(1);
  }
  console.log(`Target: ${restaurant.name} (${slug})  →  restaurantId=${restaurant.id}`);

  const actions = await plan(restaurant.id);

  if (applyMode) {
    await apply(actions);
  }
  printPlan(actions, applyMode);

  await db.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await db.$disconnect();
  process.exit(1);
});
