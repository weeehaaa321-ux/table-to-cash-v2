import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaffAuth } from "@/lib/api-auth";

/**
 * GET /api/hotel/reports?period=week|month|custom&from=&to=
 *
 * Returns the standard hotelier KPIs for the given window:
 *   - Occupancy %        — booked-room-nights / available-room-nights
 *   - ADR (avg daily rate) — room-night revenue / booked-room-nights
 *   - RevPAR             — room-night revenue / available-room-nights
 *   - Channel mix        — count + revenue per source
 *   - Net revenue        — gross − channel commission (per source)
 *
 * The math walks every non-voided ROOM_NIGHT charge whose `night`
 * falls inside the window. Inventory is rooms-of-each-type currently
 * existing (not historical — we don't track inventory deltas yet).
 */
export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request, ["OWNER", "FRONT_DESK"]);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const period = url.searchParams.get("period") || "month";
  let from: Date;
  let to: Date;
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  if (period === "custom" && url.searchParams.get("from") && url.searchParams.get("to")) {
    from = new Date(url.searchParams.get("from")!);
    to = new Date(url.searchParams.get("to")!);
  } else if (period === "week") {
    from = new Date(now);
    from.setUTCDate(from.getUTCDate() - 7);
    to = new Date(now);
  } else {
    // default: last 30 days
    from = new Date(now);
    from.setUTCDate(from.getUTCDate() - 30);
    to = new Date(now);
  }

  const hotel = await db.hotel.findUnique({
    where: { restaurantId: auth.restaurantId },
    select: { id: true },
  });
  if (!hotel) {
    return NextResponse.json({ error: "No hotel" }, { status: 404 });
  }

  // Inventory — currently-existing rooms excluding maintenance.
  const totalRooms = await db.room.count({
    where: { hotelId: hotel.id, status: { not: "MAINTENANCE" } },
  });
  const windowDays = Math.max(
    1,
    Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000))
  );
  const availableRoomNights = totalRooms * windowDays;

  // Pull every ROOM_NIGHT charge in the window with its reservation
  // source (so we can split revenue by channel).
  const charges = await db.folioCharge.findMany({
    where: {
      voided: false,
      type: "ROOM_NIGHT",
      night: { gte: from, lt: to },
      folio: { reservation: { hotelId: hotel.id } },
    },
    select: {
      amount: true,
      folio: {
        select: {
          reservation: {
            select: {
              source: true,
              commissionPercent: true,
            },
          },
        },
      },
    },
  });

  let bookedRoomNights = 0;
  let roomRevenue = 0;
  type ChannelStats = {
    source: string;
    nights: number;
    gross: number;
    commission: number;
    net: number;
  };
  const byChannel = new Map<string, ChannelStats>();
  for (const c of charges) {
    const source = c.folio.reservation.source;
    const amount = Number(c.amount);
    bookedRoomNights += 1;
    roomRevenue += amount;
    const cur = byChannel.get(source) || {
      source,
      nights: 0,
      gross: 0,
      commission: 0,
      net: 0,
    };
    cur.nights += 1;
    cur.gross += amount;
    const cp = c.folio.reservation.commissionPercent
      ? Number(c.folio.reservation.commissionPercent)
      : defaultCommissionFor(source);
    const commissionPart = (amount * cp) / 100;
    cur.commission += commissionPart;
    cur.net += amount - commissionPart;
    byChannel.set(source, cur);
  }

  const occupancyPercent =
    availableRoomNights > 0
      ? (bookedRoomNights / availableRoomNights) * 100
      : 0;
  const adr = bookedRoomNights > 0 ? roomRevenue / bookedRoomNights : 0;
  const revPar =
    availableRoomNights > 0 ? roomRevenue / availableRoomNights : 0;

  // Settlements that closed in this window — actual cash collected.
  const settled = await db.folio.aggregate({
    where: {
      status: "SETTLED",
      settledAt: { gte: from, lt: to },
      reservation: { hotelId: hotel.id },
    },
    _sum: { settledTotal: true },
    _count: true,
  });

  return NextResponse.json({
    period,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    inventory: {
      totalRooms,
      windowDays,
      availableRoomNights,
    },
    rooms: {
      bookedRoomNights,
      revenue: roomRevenue,
      occupancyPercent,
      adr,
      revPar,
    },
    settled: {
      count: settled._count,
      total: Number(settled._sum.settledTotal || 0),
    },
    channels: Array.from(byChannel.values()).sort((a, b) => b.gross - a.gross),
  });
}

/**
 * Default commission percent per channel when the reservation
 * doesn't have one set explicitly. Industry-typical numbers:
 *   Booking.com: 15-20% (we use 17 as a midpoint)
 *   Airbnb: 3% host fee (Airbnb takes ~14% from guest separately)
 *   Expedia: 15-20%
 *   TripAdvisor: 12-15%
 *   Hostelworld: 10-15%
 *   Vrbo: 8-15%
 *   Agoda: 15-20%
 *   Direct/walk-in: 0
 */
function defaultCommissionFor(source: string): number {
  switch (source) {
    case "BOOKING_COM":
      return 17;
    case "EXPEDIA":
      return 18;
    case "AIRBNB":
      return 3;
    case "TRIPADVISOR":
      return 13;
    case "HOSTELWORLD":
      return 12;
    case "VRBO":
      return 11;
    case "AGODA":
      return 18;
    default:
      return 0;
  }
}
