import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaffAuth } from "@/lib/api-auth";
import {
  countNights,
  findAvailableRooms,
  computeStayCost,
  lockTypePool,
} from "@/lib/hotel";

async function getHotelIdForStaff(restaurantId: string) {
  const hotel = await db.hotel.findUnique({
    where: { restaurantId },
    select: { id: true },
  });
  return hotel?.id ?? null;
}

/**
 * GET /api/hotel/reservations?status=BOOKED|CHECKED_IN|...&from=&to=
 * Lists reservations matching the filters. Used by the reservations
 * tab in the hotel admin.
 */
export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request, ["OWNER", "FRONT_DESK"]);
  if (auth instanceof NextResponse) return auth;

  const hotelId = await getHotelIdForStaff(auth.restaurantId);
  if (!hotelId) return NextResponse.json({ reservations: [] });

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const guestId = url.searchParams.get("guestId");

  const where: Record<string, unknown> = { hotelId };
  if (status) where.status = status;
  if (guestId) where.guestId = guestId;
  if (from && to) {
    where.AND = [
      { checkInDate: { lt: new Date(to) } },
      { checkOutDate: { gt: new Date(from) } },
    ];
  }

  const reservations = await db.reservation.findMany({
    where,
    include: {
      guest: true,
      room: { include: { roomType: true } },
      folio: { include: { charges: { where: { voided: false } } } },
    },
    orderBy: [{ checkInDate: "desc" }],
    take: 200,
  });
  return NextResponse.json({ reservations });
}

/**
 * POST /api/hotel/reservations — create a new booking. The folio is
 * created in the same transaction so the reservation is never in a
 * "no folio yet" state. Conflicts (same room, overlapping dates) are
 * rejected with 409.
 */
export async function POST(request: NextRequest) {
  const auth = await requireStaffAuth(request, ["OWNER", "FRONT_DESK"]);
  if (auth instanceof NextResponse) return auth;

  const hotelId = await getHotelIdForStaff(auth.restaurantId);
  if (!hotelId) return NextResponse.json({ error: "No hotel" }, { status: 400 });

  const body = await request.json();
  const {
    guestId,
    roomId,
    checkInDate,
    checkOutDate,
    nightlyRate,
    adults,
    children,
    source,
    specialRequests,
    internalNotes,
    openingDeposit,
  } = body;

  if (!guestId || !roomId || !checkInDate || !checkOutDate) {
    return NextResponse.json(
      { error: "guestId, roomId, checkInDate, checkOutDate required" },
      { status: 400 }
    );
  }

  const checkIn = new Date(checkInDate);
  const checkOut = new Date(checkOutDate);
  if (countNights(checkIn, checkOut) <= 0) {
    return NextResponse.json({ error: "checkOutDate must be after checkInDate" }, { status: 400 });
  }

  // Front desk can pick a specific room (typical for walk-ins) or
  // pre-assign by type only (typical for direct bookings ahead of
  // check-in, so we can pool inventory). Both paths run their
  // availability check + insert inside an advisory-locked
  // transaction; concurrent callers serialise on the (hotel, type)
  // pool so the read→write window can't oversell.
  const room = await db.room.findUnique({
    where: { id: roomId, hotelId },
    include: { roomType: true },
  });
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  // Snapshot stay cost: avg-of-mixed-rates so the snapshot matches
  // what check-in actually bills (which uses rateForNight per night).
  const nights = countNights(checkIn, checkOut);
  const cost = computeStayCost(room.roomType, checkIn, checkOut);
  const computedAvg =
    nights > 0 ? cost.total / nights : Number(room.roomType.baseRate);
  const rate =
    typeof nightlyRate === "number" && nightlyRate >= 0
      ? nightlyRate
      : computedAvg;

  let conflictMessage: string | null = null;
  const reservation = await db.$transaction(async (tx) => {
    await lockTypePool(tx, hotelId, room.roomTypeId);

    // Type-pool check inside the lock.
    const inventory = await tx.room.count({
      where: { hotelId, roomTypeId: room.roomTypeId, status: { not: "MAINTENANCE" } },
    });
    const overlapping = await tx.reservation.count({
      where: {
        hotelId,
        roomTypeId: room.roomTypeId,
        status: { in: ["BOOKED", "CHECKED_IN"] },
        AND: [
          { checkInDate: { lt: checkOut } },
          { checkOutDate: { gt: checkIn } },
        ],
      },
    });
    if (overlapping >= inventory) {
      conflictMessage = "All rooms of that type are booked for the requested dates";
      return null;
    }

    // Walk-in (room-specific) path: also check this exact room isn't
    // pinned by another booking. Inside the same lock + transaction.
    if (roomId) {
      const conflict = await tx.reservation.findFirst({
        where: {
          hotelId,
          roomId,
          status: { in: ["BOOKED", "CHECKED_IN"] },
          AND: [
            { checkInDate: { lt: checkOut } },
            { checkOutDate: { gt: checkIn } },
          ],
        },
        select: { id: true },
      });
      if (conflict) {
        conflictMessage = "Room is held by another reservation for those dates";
        return null;
      }
    }

    const created = await tx.reservation.create({
      data: {
        hotelId,
        guestId,
        roomTypeId: room.roomTypeId,
        roomId,
        checkInDate: checkIn,
        checkOutDate: checkOut,
        nightlyRate: rate,
        adults: Math.max(1, Number(adults) || 2),
        children: Math.max(0, Number(children) || 0),
        source: source || "DIRECT",
        status: "BOOKED",
        specialRequests: specialRequests?.trim() || null,
        internalNotes: internalNotes?.trim() || null,
        createdById: auth.id,
      },
    });
    await tx.folio.create({
      data: {
        reservationId: created.id,
        openingDeposit:
          typeof openingDeposit === "number" && openingDeposit > 0 ? openingDeposit : 0,
      },
    });
    return created;
  });

  if (conflictMessage || !reservation) {
    return NextResponse.json(
      { error: conflictMessage || "Booking failed" },
      { status: 409 }
    );
  }

  const full = await db.reservation.findUnique({
    where: { id: reservation.id },
    include: {
      guest: true,
      room: { include: { roomType: true } },
      folio: { include: { charges: true } },
    },
  });
  return NextResponse.json({ reservation: full });
}
