import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { findAvailableRooms } from "@/lib/hotel";

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
  const byType = new Map<
    string,
    {
      id: string;
      name: string;
      description: string | null;
      capacity: number;
      baseRate: number;
      amenities: string[];
      availableCount: number;
    }
  >();
  for (const room of rooms) {
    const t = byType.get(room.roomTypeId);
    if (t) {
      t.availableCount += 1;
    } else {
      byType.set(room.roomTypeId, {
        id: room.roomTypeId,
        name: room.roomType.name,
        description: room.roomType.description,
        capacity: room.roomType.capacity,
        baseRate: Number(room.roomType.baseRate),
        amenities: room.roomType.amenities,
        availableCount: 1,
      });
    }
  }

  return NextResponse.json({ types: Array.from(byType.values()) });
}
