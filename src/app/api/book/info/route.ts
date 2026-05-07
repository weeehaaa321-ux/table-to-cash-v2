import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/book/info?slug=neom-dahab
 * Public — used by /book to render the property name, address,
 * check-in/out times, and the published room types with rates.
 * No PII, no authentication.
 */
export async function GET(request: NextRequest) {
  const slug = new URL(request.url).searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });

  const restaurant = await db.restaurant.findUnique({
    where: { slug },
    select: {
      name: true,
      hotel: {
        select: {
          id: true,
          name: true,
          address: true,
          checkInTime: true,
          checkOutTime: true,
          roomTypes: {
            orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
            select: {
              id: true,
              name: true,
              description: true,
              capacity: true,
              baseRate: true,
              amenities: true,
            },
          },
        },
      },
    },
  });

  if (!restaurant?.hotel) {
    return NextResponse.json({ error: "Hotel not found" }, { status: 404 });
  }

  return NextResponse.json({ hotel: restaurant.hotel });
}
