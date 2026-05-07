import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { findAvailableRooms, computeStayCost } from "@/lib/hotel";

/**
 * GET /api/book/availability?slug=&from=&to=
 * Public availability check for the booking page. Returns free rooms
 * for the requested range, grouped by room type with the cheapest
 * available rate per type — what's relevant to a guest browsing
 * direct bookings. Internal admin-only details (notes, status,
 * floor) are not exposed.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!slug || !from || !to) {
    return NextResponse.json(
      { error: "slug, from, to required" },
      { status: 400 }
    );
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return NextResponse.json({ error: "Invalid dates" }, { status: 400 });
  }
  if (toDate <= fromDate) {
    return NextResponse.json({ error: "to must be after from" }, { status: 400 });
  }

  const restaurant = await db.restaurant.findUnique({
    where: { slug },
    select: { hotel: { select: { id: true } } },
  });
  if (!restaurant?.hotel) {
    return NextResponse.json({ error: "Hotel not found" }, { status: 404 });
  }

  const rooms = await findAvailableRooms(restaurant.hotel.id, fromDate, toDate);
  // Group by room type — the booking page lets guests pick a TYPE
  // (e.g. "Sea View"), and we assign the actual room number at
  // booking time. Avoids exposing per-room internal numbering.
  type Bucket = {
    id: string;
    name: string;
    description: string | null;
    capacity: number;
    baseRate: number;
    weekendRate: number | null;
    minNights: number;
    amenities: string[];
    availableCount: number;
    /** Total cost for the requested range, factoring in weekend
     *  pricing per night. Saves the client from doing the math
     *  wrong. */
    totalForRange: number;
    /** True if the range is shorter than the type's min-nights —
     *  the booking page should grey out / refuse this option. */
    belowMinNights: boolean;
  };
  const byType = new Map<string, Bucket>();
  for (const room of rooms) {
    const t = byType.get(room.roomTypeId);
    if (t) {
      t.availableCount += 1;
    } else {
      const cost = computeStayCost(room.roomType, fromDate, toDate);
      const nights = Math.round(
        (toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000)
      );
      byType.set(room.roomTypeId, {
        id: room.roomTypeId,
        name: room.roomType.name,
        description: room.roomType.description,
        capacity: room.roomType.capacity,
        baseRate: Number(room.roomType.baseRate),
        weekendRate:
          room.roomType.weekendRate != null
            ? Number(room.roomType.weekendRate)
            : null,
        minNights: room.roomType.minNights,
        amenities: room.roomType.amenities,
        availableCount: 1,
        totalForRange: cost.total,
        belowMinNights: nights < room.roomType.minNights,
      });
    }
  }

  return NextResponse.json({ types: Array.from(byType.values()) });
}
