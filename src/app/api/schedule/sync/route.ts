import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { restaurantId } = body;
  if (!restaurantId) return NextResponse.json({ error: "restaurantId required" }, { status: 400 });
  try {
    const realId = await useCases.schedule.resolveRestaurantId(restaurantId);
    if (!realId) return NextResponse.json({ error: "Restaurant not found" }, { status: 400 });
    const synced = await useCases.schedule.forceSync(realId);
    return NextResponse.json({ synced });
  } catch (err) {
    console.error("Schedule sync failed:", err);
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
