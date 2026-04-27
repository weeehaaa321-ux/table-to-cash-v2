import { NextRequest, NextResponse } from "next/server";
import { legacyDb as db } from "@/infrastructure/composition";

// GET: Check if any delivery drivers are currently online
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const rawId = url.searchParams.get("restaurantId") || "";

  let restaurantId: string | null = null;
  if (rawId) {
    if (rawId.startsWith("c") && rawId.length > 10) {
      restaurantId = rawId;
    } else {
      const r = await db.restaurant.findUnique({ where: { slug: rawId }, select: { id: true } });
      restaurantId = r?.id || null;
    }
  }

  if (!restaurantId) {
    return NextResponse.json({ available: false });
  }

  const count = await db.staff.count({
    where: {
      restaurantId,
      role: "DELIVERY",
      active: true,
      deliveryOnline: true,
    },
  });

  return NextResponse.json({ available: count > 0 });
}
