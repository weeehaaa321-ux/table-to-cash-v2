import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaffAuth } from "@/lib/api-auth";
import { findAvailableRooms } from "@/lib/hotel";

/**
 * GET /api/hotel/availability?from=YYYY-MM-DD&to=YYYY-MM-DD
 *           &excludeReservationId=... (optional, when editing a booking)
 * Returns the rooms that are free for the entire requested range.
 * "Free" excludes maintenance rooms and rooms with overlapping
 * non-cancelled reservations.
 */
export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request, ["OWNER", "FRONT_DESK"]);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const excludeReservationId = url.searchParams.get("excludeReservationId") || undefined;
  if (!from || !to) {
    return NextResponse.json({ error: "from and to required" }, { status: 400 });
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return NextResponse.json({ error: "Invalid dates" }, { status: 400 });
  }
  if (toDate <= fromDate) {
    return NextResponse.json({ error: "to must be after from" }, { status: 400 });
  }

  const hotel = await db.hotel.findUnique({
    where: { restaurantId: auth.restaurantId },
    select: { id: true },
  });
  if (!hotel) return NextResponse.json({ rooms: [] });

  const rooms = await findAvailableRooms(hotel.id, fromDate, toDate, {
    excludeReservationId,
  });
  return NextResponse.json({ rooms });
}
