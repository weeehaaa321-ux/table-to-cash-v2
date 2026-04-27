import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const restaurantId = url.searchParams.get("restaurantId") || "";

  try {
    const realId = await useCases.menuAdmin.resolveRestaurantId(restaurantId);
    if (!realId) return NextResponse.json({ categories: [] });

    const categories = await useCases.menuAdmin.listCategoriesWithItems(realId);
    return NextResponse.json({ categories });
  } catch (err) {
    console.error("Failed to fetch admin menu:", err);
    return NextResponse.json({ error: "Failed to fetch menu" }, { status: 500 });
  }
}

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
    const item = await useCases.menuAdmin.createItem({
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
    });
    return NextResponse.json(item, { status: 201 });
  } catch (err) {
    console.error("Failed to create menu item:", err);
    return NextResponse.json({ error: "Failed to create item" }, { status: 500 });
  }
}

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
    const item = await useCases.menuAdmin.updateItem(id, data);
    return NextResponse.json(item);
  } catch (err) {
    console.error("Failed to update menu item:", err);
    return NextResponse.json({ error: "Failed to update item" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { id } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const used = await useCases.menuAdmin.countOrderItemsForMenuItem(id);
    if (used > 0) {
      const item = await useCases.menuAdmin.deactivateItem(id);
      return NextResponse.json({ ok: true, deactivated: true, item });
    }

    await useCases.menuAdmin.deleteItemAndAddOns(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to delete menu item:", err);
    return NextResponse.json({ error: "Failed to delete item" }, { status: 500 });
  }
}
