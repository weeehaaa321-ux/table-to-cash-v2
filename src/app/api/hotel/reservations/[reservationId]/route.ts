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
    const updated = await db.reservation.update({
      where: { id: reservationId },
      data: { checkOutDate: newCheckOut },
    });
    return NextResponse.json({ reservation: updated });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
