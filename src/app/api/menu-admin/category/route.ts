import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// PATCH /api/menu-admin/category
// { id, availableFromHour?, availableToHour?, name?, nameAr?, nameRu? }
// Used by the dashboard menu tab to set category-level time windows
// (e.g. breakfast 8-13). Items inherit these unless they set their own.
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, ...rest } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  const allowed = [
    "name",
    "nameAr",
    "nameRu",
    "icon",
    "sortOrder",
    "station",
    "availableFromHour",
    "availableToHour",
  ] as const;

  const data: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in rest) data[key] = rest[key];
  }

  try {
    const cat = await db.category.update({ where: { id }, data });
    return NextResponse.json(cat);
  } catch (err) {
    console.error("Failed to update category:", err);
    return NextResponse.json({ error: "Failed to update category" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { id } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const items = await db.menuItem.findMany({
      where: { categoryId: id },
      select: { id: true },
    });
    if (items.length > 0) {
      const itemIds = items.map((i) => i.id);
      await db.addOn.deleteMany({ where: { menuItemId: { in: itemIds } } });
      await db.menuItem.deleteMany({ where: { categoryId: id } });
    }
    await db.category.delete({ where: { id } });
    return NextResponse.json({ ok: true, deletedItems: items.length });
  } catch (err) {
    console.error("Failed to delete category:", err);
    return NextResponse.json({ error: "Failed to delete category" }, { status: 500 });
  }
}
