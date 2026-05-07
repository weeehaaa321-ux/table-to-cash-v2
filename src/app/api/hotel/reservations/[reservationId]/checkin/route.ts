import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaffAuth } from "@/lib/api-auth";
import { countNights } from "@/lib/hotel";

/**
 * POST /api/hotel/reservations/[id]/checkin
 * Marks the reservation CHECKED_IN, sets checkedInAt timestamp,
 * flips the room status to OCCUPIED, and posts ROOM_NIGHT folio
 * charges for each booked night up front. If the guest extends or
 * shortens later, the difference is reconciled at checkout.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reservationId: string }> }
) {
  const auth = await requireStaffAuth(request, ["OWNER", "FRONT_DESK"]);
  if (auth instanceof NextResponse) return auth;

  const { reservationId } = await params;
  const reservation = await db.reservation.findUnique({
    where: { id: reservationId },
    include: {
      hotel: { select: { restaurantId: true } },
      folio: true,
      room: true,
      guest: { select: { name: true } },
    },
  });
  if (!reservation || reservation.hotel.restaurantId !== auth.restaurantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (reservation.status !== "BOOKED") {
    return NextResponse.json(
      { error: `Cannot check in from status ${reservation.status}` },
      { status: 409 }
    );
  }
  if (!reservation.folio) {
    return NextResponse.json({ error: "Folio missing" }, { status: 500 });
  }

  const nights = countNights(reservation.checkInDate, reservation.checkOutDate);
  const rate = Number(reservation.nightlyRate);

  await db.$transaction(async (tx) => {
    await tx.reservation.update({
      where: { id: reservationId },
      data: { status: "CHECKED_IN", checkedInAt: new Date() },
    });
    await tx.room.update({
      where: { id: reservation.roomId },
      data: { status: "OCCUPIED" },
    });

    // Post one ROOM_NIGHT charge per booked night. The night field
    // stores the check-in side of each night (so a 5/10–5/13 stay
    // produces three rows: 5/10, 5/11, 5/12).
    for (let i = 0; i < nights; i++) {
      const night = new Date(reservation.checkInDate);
      night.setUTCDate(night.getUTCDate() + i);
      await tx.folioCharge.create({
        data: {
          folioId: reservation.folio!.id,
          type: "ROOM_NIGHT",
          amount: rate,
          description: `Room ${reservation.room.number} — ${night.toISOString().slice(0, 10)}`,
          night,
          chargedById: auth.id,
        },
      });
    }
  });

  return NextResponse.json({ ok: true });
}
