import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { syncTodaySchedule, invalidateScheduleSync } from "@/lib/schedule-sync";

async function resolveRestaurantId(id: string): Promise<string | null> {
  if (!id) return null;
  if (id.startsWith("c") && id.length > 10) return id;
  const r = await db.restaurant.findUnique({
    where: { slug: id },
    select: { id: true },
  });
  return r?.id || null;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { restaurantId } = body;

  if (!restaurantId) {
    return NextResponse.json({ error: "restaurantId required" }, { status: 400 });
  }

  try {
    const realId = await resolveRestaurantId(restaurantId);
    if (!realId) return NextResponse.json({ error: "Restaurant not found" }, { status: 400 });

    invalidateScheduleSync(realId);
    const synced = await syncTodaySchedule(realId);
    return NextResponse.json({ synced });
  } catch (err) {
    console.error("Schedule sync failed:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
