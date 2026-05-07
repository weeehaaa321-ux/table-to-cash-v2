import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaffAuth } from "@/lib/api-auth";

async function loadReservation(reservationId: string, restaurantId: string) {
  const reservation = await db.reservation.findUnique({
    where: { id: reservationId },
    include: {
      hotel: { select: { restaurantId: true } },
      guest: true,
      room: { include: { roomType: true } },
      folio: { include: { charges: { orderBy: { chargedAt: "desc" } } } },
      sessions: { select: { id: true, openedAt: true, closedAt: true } },
    },
  });
  if (!reservation || reservation.hotel.restaurantId !== restaurantId) return null;
  return reservation;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ reservationId: string }> }
) {
  const auth = await requireStaffAuth(request, ["OWNER", "FRONT_DESK", "CASHIER"]);
  if (auth instanceof NextResponse) return auth;

  const { reservationId } = await params;
  const reservation = await loadReservation(reservationId, auth.restaurantId);
  if (!reservation) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ reservation });
}

/**
 * PATCH /api/hotel/reservations/[reservationId]
 * Body { action } drives the state transition:
 *   - "cancel"   : reservation -> CANCELLED, folio -> VOID
 *   - "no_show"  : reservation -> NO_SHOW, folio -> VOID
 *   - "edit"     : update editable fields (dates, room, notes, etc.)
 *   - "extend"   : change checkOutDate (after CHECKED_IN)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ reservationId: string }> }
) {
  const auth = await requireStaffAuth(request, ["OWNER", "FRONT_DESK"]);
  if (auth instanceof NextResponse) return auth;

  const { reservationId } = await params;
  const reservation = await loadReservation(reservationId, auth.restaurantId);
  if (!reservation) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json();
  const { action } = body;

  if (action === "cancel") {
    if (reservation.status === "CHECKED_OUT") {
      return NextResponse.json({ error: "Already checked out" }, { status: 409 });
    }
    const reason = (body.reason || "").trim() || null;
    await db.$transaction(async (tx) => {
      await tx.reservation.update({
        where: { id: reservationId },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason },
      });
      if (reservation.folio) {
        await tx.folio.update({
          where: { id: reservation.folio.id },
          data: { status: "VOID" },
        });
      }
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "no_show") {
    await db.$transaction(async (tx) => {
      await tx.reservation.update({
        where: { id: reservationId },
        data: { status: "NO_SHOW" },
      });
      if (reservation.folio) {
        await tx.folio.update({
          where: { id: reservation.folio.id },
          data: { status: "VOID" },
        });
      }
    });
    return NextResponse.json({ ok: true });
  }

  if (action === "edit") {
    const data: Record<string, unknown> = {};
    if (body.specialRequests !== undefined) data.specialRequests = body.specialRequests?.trim() || null;
    if (body.internalNotes !== undefined) data.internalNotes = body.internalNotes?.trim() || null;
    if (typeof body.adults === "number") data.adults = body.adults;
    if (typeof body.children === "number") data.children = body.children;
    if (typeof body.nightlyRate === "number") data.nightlyRate = body.nightlyRate;
    // OTA confirmation code (Booking.com / Airbnb / Expedia / etc.).
    // Front desk pastes this from the OTA's confirmation email so we
    // can cross-check on their extranet at check-in.
    if (body.externalRef !== undefined) {
      data.externalRef = typeof body.externalRef === "string" && body.externalRef.trim()
        ? body.externalRef.trim()
        : null;
    }
    if (typeof body.commissionPercent === "number") {
      data.commissionPercent = body.commissionPercent;
    }
    if (typeof body.prepaid === "boolean") {
      data.prepaid = body.prepaid;
    }
    // Replace placeholder guest details with real ones at check-in.
    // The Guest model holds these; we update the related row instead
    // of mirroring fields on Reservation.
    if (body.guestName?.trim() || body.guestPhone?.trim() || body.guestIdNumber?.trim() || body.guestNationality?.trim()) {
      const guestData: Record<string, unknown> = {};
      if (body.guestName?.trim()) guestData.name = body.guestName.trim();
      if (body.guestPhone?.trim()) guestData.phone = body.guestPhone.trim();
      if (body.guestIdNumber?.trim()) guestData.idNumber = body.guestIdNumber.trim();
      if (body.guestNationality?.trim()) guestData.nationality = body.guestNationality.trim();
      if (body.guestEmail?.trim()) guestData.email = body.guestEmail.trim();
      await db.guest.update({ where: { id: reservation.guestId }, data: guestData });
    }
    const updated = await db.reservation.update({
      where: { id: reservationId },
      data,
    });
    return NextResponse.json({ reservation: updated });
  }

  if (action === "extend") {
    const newCheckOut = body.checkOutDate ? new Date(body.checkOutDate) : null;
    if (!newCheckOut) return NextResponse.json({ error: "checkOutDate required" }, { status: 400 });
    if (newCheckOut <= reservation.checkInDate) {
      return NextResponse.json({ error: "checkOutDate must be after checkInDate" }, { status: 400 });
    }
    if (newCheckOut <= reservation.checkOutDate) {
      return NextResponse.json(
        { error: "Extension date must be after current checkout" },
        { status: 400 }
      );
    }
    // Conflict check: another booking on this room covering any of the
    // newly added nights would silently overlap if we just extended.
    // Reuse the availability finder and ensure our room is still free
    // for the extended range (excluding ourselves).
    const stillFree = await import("@/lib/hotel").then((m) =>
      m.findAvailableRooms(reservation.hotelId, reservation.checkOutDate, newCheckOut, {
        excludeReservationId: reservationId,
      })
    );
    if (!stillFree.find((r) => r.id === reservation.roomId)) {
      return NextResponse.json(
        { error: "Room is booked by another reservation in the extension window" },
        { status: 409 }
      );
    }

    // Post one ROOM_NIGHT charge per added night (so the folio reflects
    // the extension immediately — checkout reconciles too, but staff
    // and guest both see the cost on the folio right away).
    const rate = Number(reservation.nightlyRate);
    await db.$transaction(async (tx) => {
      await tx.reservation.update({
        where: { id: reservationId },
        data: { checkOutDate: newCheckOut },
      });
      if (reservation.folio?.id) {
        const cur = new Date(reservation.checkOutDate);
        while (cur < newCheckOut) {
          const night = new Date(cur);
          await tx.folioCharge.create({
            data: {
              folioId: reservation.folio.id,
              type: "ROOM_NIGHT",
              amount: rate,
              description: `Room ${reservation.room?.number ?? "unassigned"} — ${night.toISOString().slice(0, 10)} (extension)`,
              night,
              chargedById: auth.id,
            },
          });
          cur.setUTCDate(cur.getUTCDate() + 1);
        }
      }
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
