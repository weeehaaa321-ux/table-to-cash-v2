import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaffAuth } from "@/lib/api-auth";

/**
 * GET /api/hotel/today
 * Front-desk dashboard: today's arrivals, today's departures, and
 * everyone currently in-house. Date math is in UTC for now (Cairo is
 * UTC+2/+3; close enough for "what's happening today" — refine later
 * if it bites).
 */
export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request, ["OWNER", "FRONT_DESK"]);
  if (auth instanceof NextResponse) return auth;

  const hotel = await db.hotel.findUnique({
    where: { restaurantId: auth.restaurantId },
    select: { id: true },
  });
  if (!hotel) {
    return NextResponse.json({
      hotel: null,
      arrivals: [],
      departures: [],
      inHouse: [],
      occupancy: { occupied: 0, total: 0 },
    });
  }

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1);

  const baseInclude = {
    guest: true,
    room: { include: { roomType: true } },
    folio: { include: { charges: { where: { voided: false } } } },
  };

  const [arrivals, departures, inHouse, totalRooms, occupiedRooms] = await Promise.all([
    db.reservation.findMany({
      where: {
        hotelId: hotel.id,
        status: "BOOKED",
        checkInDate: { gte: todayStart, lt: tomorrowStart },
      },
      include: baseInclude,
      orderBy: { checkInDate: "asc" },
    }),
    db.reservation.findMany({
      where: {
        hotelId: hotel.id,
        status: "CHECKED_IN",
        checkOutDate: { gte: todayStart, lt: tomorrowStart },
      },
      include: baseInclude,
      orderBy: { checkOutDate: "asc" },
    }),
    db.reservation.findMany({
      where: { hotelId: hotel.id, status: "CHECKED_IN" },
      include: baseInclude,
      orderBy: { checkInDate: "desc" },
    }),
    db.room.count({ where: { hotelId: hotel.id } }),
    db.room.count({ where: { hotelId: hotel.id, status: "OCCUPIED" } }),
  ]);

  return NextResponse.json({
    hotel,
    arrivals,
    departures,
    inHouse,
    occupancy: { occupied: occupiedRooms, total: totalRooms },
  });
}
