import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";

// GET: Check if any delivery drivers are currently online
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const rawId = url.searchParams.get("restaurantId") || "";

  const restaurantId = rawId ? await useCases.delivery.resolveRestaurantId(rawId) : null;
  if (!restaurantId) {
    return NextResponse.json({ available: false });
  }

  const count = await useCases.delivery.countOnlineDrivers(restaurantId);
  return NextResponse.json({ available: count > 0 });
}
