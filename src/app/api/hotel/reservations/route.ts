import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaffAuth } from "@/lib/api-auth";
import { countNights, findAvailableRooms, findAvailableRoomTypes } from "@/lib/hotel";

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
  // check-in, so we can pool inventory). Both paths must check
  // type-level availability; the room-specific path additionally
  // verifies the chosen room isn't already held by a roomId-bound
  // reservation in the same window.
  const room = await db.room.findUnique({
    where: { id: roomId, hotelId },
    include: { roomType: true },
  });
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const types = await findAvailableRoomTypes(hotelId, checkIn, checkOut);
  const targetType = types.find((t) => t.id === room.roomTypeId);
  if (!targetType || targetType.available <= 0) {
    return NextResponse.json(
      { error: "All rooms of that type are booked for the requested dates" },
      { status: 409 }
    );
  }

  // Walk-in (room-specific) path: also check this exact room isn't
  // pinned by another booking. The findAvailableRooms predicate is
  // the right tool for this.
  if (roomId) {
    const physicalAvailable = await findAvailableRooms(hotelId, checkIn, checkOut);
    if (!physicalAvailable.find((r) => r.id === roomId)) {
      return NextResponse.json(
        { error: "Room is held by another reservation for those dates" },
        { status: 409 }
      );
    }
  }

  const rate = typeof nightlyRate === "number" && nightlyRate >= 0
    ? nightlyRate
    : Number(room.roomType.baseRate);

  const reservation = await db.$transaction(async (tx) => {
    const created = await tx.reservation.create({
      data: {
        hotelId,
        guestId,
        roomTypeId: room.roomTypeId,
        roomId, // explicit assignment from the admin UI; OK to be set here
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
        openingDeposit: typeof openingDeposit === "number" && openingDeposit > 0 ? openingDeposit : 0,
      },
    });
    return created;
  });

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
