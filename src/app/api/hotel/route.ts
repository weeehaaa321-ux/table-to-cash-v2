import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaffAuth } from "@/lib/api-auth";

/**
 * GET /api/hotel?slug=neom-dahab
 * Returns the hotel config for a restaurant, or 404 if no hotel
 * module is configured. Public — used by the cashier UI to decide
 * whether to show Charge-to-Room (no PII leak: just config flags).
 */
export async function GET(request: NextRequest) {
  const slug = new URL(request.url).searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });

  const restaurant = await db.restaurant.findUnique({
    where: { slug },
    select: { id: true, name: true, hotel: true },
  });
  if (!restaurant) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!restaurant.hotel) return NextResponse.json({ hotel: null });

  return NextResponse.json({ hotel: restaurant.hotel });
}

/**
 * POST /api/hotel — owner creates the hotel row for their restaurant.
 * One per restaurant; existing rows are updated (upsert).
 */
export async function POST(request: NextRequest) {
  const auth = await requireStaffAuth(request, ["OWNER"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const { name, address, checkInTime, checkOutTime } = body;
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  const hotel = await db.hotel.upsert({
    where: { restaurantId: auth.restaurantId },
    create: {
      restaurantId: auth.restaurantId,
      name: name.trim(),
      address: address?.trim() || null,
      checkInTime: checkInTime || "14:00",
      checkOutTime: checkOutTime || "12:00",
    },
    update: {
      name: name.trim(),
      address: address?.trim() || null,
      checkInTime: checkInTime || "14:00",
      checkOutTime: checkOutTime || "12:00",
    },
  });

  return NextResponse.json({ hotel });
}
