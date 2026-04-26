import { NextRequest, NextResponse } from "next/server";
import { getRestaurantBySlug, getDefaultRestaurant } from "@/lib/queries";
import { db } from "@/lib/db";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");

  try {
    const restaurant = slug
      ? await getRestaurantBySlug(slug)
      : await getDefaultRestaurant();

    if (!restaurant) {
      return NextResponse.json(
        { error: "Restaurant not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(restaurant);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Restaurant lookup failed:", err);
    return NextResponse.json(
      { error: "Failed to load restaurant" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { slug, waiterCapacity } = await request.json();
    if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });
    const data: Record<string, unknown> = {};
    if (waiterCapacity !== undefined) data.waiterCapacity = Math.max(1, Math.min(99, Number(waiterCapacity)));
    await db.restaurant.update({ where: { slug }, data });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Restaurant update failed:", err);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
