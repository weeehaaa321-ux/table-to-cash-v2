import { NextRequest, NextResponse } from "next/server";
import { legacyDb as db } from "@/infrastructure/composition";

async function resolveRestaurantId(id: string): Promise<string | null> {
  if (!id) return null;
  if (id.startsWith("c") && id.length > 10) return id;
  const r = await db.restaurant.findUnique({
    where: { slug: id },
    select: { id: true },
  });
  return r?.id || null;
}

// GET /api/menu-admin?restaurantId=slug
// Returns every category + every item (including unavailable ones).
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const restaurantId = url.searchParams.get("restaurantId") || "";

  try {
    const realId = await resolveRestaurantId(restaurantId);
    if (!realId) return NextResponse.json({ categories: [] });

    const categories = await db.category.findMany({
      where: { restaurantId: realId },
      orderBy: { sortOrder: "asc" },
      include: {
        items: {
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    return NextResponse.json({ categories });
  } catch (err) {
    console.error("Failed to fetch admin menu:", err);
    return NextResponse.json({ error: "Failed to fetch menu" }, { status: 500 });
  }
}

// POST /api/menu-admin
// { restaurantId, categoryId, name, price, description?, image?, available?,
//   bestSeller?, highMargin?, calories?, prepTime? }
export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    categoryId,
    name,
    price,
    description,
    image,
    available = true,
    bestSeller = false,
    highMargin = false,
    calories,
    prepTime,
    availableFromHour,
    availableToHour,
  } = body;

  if (!categoryId || !name || typeof price !== "number") {
    return NextResponse.json(
      { error: "categoryId, name, and price are required" },
      { status: 400 }
    );
  }

  try {
    const item = await db.menuItem.create({
      data: {
        categoryId,
        name,
        price,
        description: description || null,
        image: image || null,
        available,
        bestSeller,
        highMargin,
        calories: typeof calories === "number" ? calories : null,
        prepTime: typeof prepTime === "number" ? prepTime : null,
        availableFromHour: typeof availableFromHour === "number" ? availableFromHour : null,
        availableToHour: typeof availableToHour === "number" ? availableToHour : null,
      },
    });
    return NextResponse.json(item, { status: 201 });
  } catch (err) {
    console.error("Failed to create menu item:", err);
    return NextResponse.json({ error: "Failed to create item" }, { status: 500 });
  }
}

// PATCH /api/menu-admin
// { id, ...fields }
// Kitchen/Bar staff can toggle availability; full edits need owner
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, ...rest } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const allowed = [
    "name",
    "price",
    "description",
    "image",
    "available",
    "bestSeller",
    "highMargin",
    "calories",
    "prepTime",
    "categoryId",
    "availableFromHour",
    "availableToHour",
  ] as const;

  const data: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in rest) data[key] = rest[key];
  }

  try {
    const item = await db.menuItem.update({ where: { id }, data });
    return NextResponse.json(item);
  } catch (err) {
    console.error("Failed to update menu item:", err);
    return NextResponse.json({ error: "Failed to update item" }, { status: 500 });
  }
}

// DELETE /api/menu-admin
// { id }
export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { id } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    // If any order items reference this menu item, deactivate instead of
    // deleting so historical orders keep their item details.
    const used = await db.orderItem.count({ where: { menuItemId: id } });
    if (used > 0) {
      const item = await db.menuItem.update({
        where: { id },
        data: { available: false },
      });
      return NextResponse.json({
        ok: true,
        deactivated: true,
        item,
      });
    }

    await db.addOn.deleteMany({ where: { menuItemId: id } });
    await db.menuItem.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to delete menu item:", err);
    return NextResponse.json({ error: "Failed to delete item" }, { status: 500 });
  }
}
