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

  const [
    arrivals,
    departures,
    inHouse,
    totalRooms,
    occupiedRooms,
    chargesPostedToday,
    foliosSettledToday,
  ] = await Promise.all([
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
    // All folio charges posted today across this hotel's folios.
    // Used to break revenue down by source on the Today tab.
    db.folioCharge.findMany({
      where: {
        chargedAt: { gte: todayStart, lt: tomorrowStart },
        voided: false,
        folio: { reservation: { hotelId: hotel.id } },
      },
      select: { type: true, amount: true },
    }),
    // Folio settlements that closed today — actual cash collected at
    // checkout today. Different from revenue posted (room-night
    // charges accrue daily; checkout aggregates them).
    db.folio.findMany({
      where: {
        status: "SETTLED",
        settledAt: { gte: todayStart, lt: tomorrowStart },
        reservation: { hotelId: hotel.id },
      },
      select: { settledMethod: true, settledTotal: true },
    }),
  ]);

  // Aggregate today's revenue by source. Numbers reported separately
  // so the dashboard can show: "Room nights billed today: X / Cafe-
  // to-room: Y / Activities-to-room: Z" — useful for the owner to
  // know what's actually moving each day.
  const revenueByType: Record<string, number> = {
    ROOM_NIGHT: 0,
    FOOD: 0,
    ACTIVITY: 0,
    MINIBAR: 0,
    MISC: 0,
  };
  for (const c of chargesPostedToday) {
    revenueByType[c.type] = (revenueByType[c.type] ?? 0) + Number(c.amount);
  }
  const collectedByMethod: Record<string, number> = {};
  let totalCollected = 0;
  for (const f of foliosSettledToday) {
    const method = f.settledMethod ?? "UNKNOWN";
    const amt = Number(f.settledTotal ?? 0);
    collectedByMethod[method] = (collectedByMethod[method] ?? 0) + amt;
    totalCollected += amt;
  }

  return NextResponse.json({
    hotel,
    arrivals,
    departures,
    inHouse,
    occupancy: { occupied: occupiedRooms, total: totalRooms },
    revenue: {
      byType: revenueByType,
      collectedByMethod,
      totalCollected,
      totalPosted: Object.values(revenueByType).reduce((a, b) => a + b, 0),
    },
  });
}
