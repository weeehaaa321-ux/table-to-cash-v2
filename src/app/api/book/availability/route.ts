import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { findAvailableRoomTypes, computeStayCost } from "@/lib/hotel";
import { rateLimit } from "@/lib/rate-limit";

/**
 * GET /api/book/availability?slug=&from=&to=
 * Public availability check for the booking page. Returns one
 * entry per room type with how many of that type are free for the
 * entire requested range — counting BOTH room-bound walk-ins AND
 * type-bound (OTA / direct) reservations against the inventory pool.
 *
 * This is the read side of /book; the actual booking POST runs the
 * same predicate inside an advisory-locked transaction so the
 * read→pick→write flow can't oversell.
 */
export async function GET(request: NextRequest) {
  // Per-IP read-side rate limit. Higher than reserve because an
  // honest browser does many availability fetches per booking.
  const rl = rateLimit(request, {
    bucket: "book-availability",
    windowMs: 60 * 60 * 1000,
    max: 60,
    blockMs: 30 * 60 * 1000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many availability checks. Try again later." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

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

  const types = await findAvailableRoomTypes(restaurant.hotel.id, fromDate, toDate);
  const nights = Math.round(
    (toDate.getTime() - fromDate.getTime()) / (24 * 60 * 60 * 1000)
  );

  // Skip types that have no inventory at all — they shouldn't appear
  // to the public even when bookings happen to be zero. Also drop
  // sensitive fields (we expose only what the booking UI renders).
  const exposed = types
    .filter((t) => t.inventory > 0)
    .map((t) => {
      const cost = computeStayCost(
        { baseRate: t.baseRate, weekendRate: t.weekendRate },
        fromDate,
        toDate
      );
      return {
        id: t.id,
        name: t.name,
        description: t.description,
        capacity: t.capacity,
        baseRate: t.baseRate,
        weekendRate: t.weekendRate,
        minNights: t.minNights,
        amenities: t.amenities,
        availableCount: t.available,
        totalForRange: cost.total,
        belowMinNights: nights < t.minNights,
      };
    });

  return NextResponse.json({ types: exposed });
}
