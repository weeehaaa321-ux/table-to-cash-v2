import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaffAuth } from "@/lib/api-auth";
import { computeFolioBalance, countNights } from "@/lib/hotel";
import {
  pickFromAddress,
  renderCheckOutReceiptEmail,
  sendEmail,
} from "@/lib/email";

/**
 * POST /api/hotel/reservations/[id]/checkout
 * Body: { paymentMethod, settledTotal? (defaults to balance) }
 *
 * Reconciles ROOM_NIGHT charges if the actual stay was longer or
 * shorter than booked (extends add charges; early departures void
 * the unused-night charges). Settles the folio with the chosen
 * method, marks the reservation CHECKED_OUT, and flips the room
 * status to VACANT_DIRTY (housekeeping decides when it's clean
 * again — we only track binary clean/dirty in Phase 1).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ reservationId: string }> }
) {
  const auth = await requireStaffAuth(request, ["OWNER", "FRONT_DESK"]);
  if (auth instanceof NextResponse) return auth;

  const { reservationId } = await params;
  const body = await request.json();
  const { paymentMethod } = body;
  if (!paymentMethod) {
    return NextResponse.json({ error: "paymentMethod required" }, { status: 400 });
  }

  const reservation = await db.reservation.findUnique({
    where: { id: reservationId },
    include: {
      hotel: {
        select: {
          restaurantId: true,
          name: true,
          notificationEmail: true,
          emailFrom: true,
        },
      },
      folio: { include: { charges: true } },
      room: true,
      guest: { select: { name: true, email: true } },
    },
  });
  if (!reservation || reservation.hotel.restaurantId !== auth.restaurantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (reservation.status !== "CHECKED_IN") {
    return NextResponse.json(
      { error: `Cannot check out from status ${reservation.status}` },
      { status: 409 }
    );
  }
  if (!reservation.folio) {
    return NextResponse.json({ error: "Folio missing" }, { status: 500 });
  }

  const now = new Date();
  // Reconcile ROOM_NIGHT charges against the actual departure.
  // checkOutDate may be in the past (early departure) or in the
  // future (late departure / extension) — we keep the booked range
  // as the truth unless the guest explicitly set body.actualCheckOut.
  const actualCheckOut = body.actualCheckOut
    ? new Date(body.actualCheckOut)
    : reservation.checkOutDate;
  const actualNights = countNights(reservation.checkInDate, actualCheckOut);

  await db.$transaction(async (tx) => {
    // Void room-night charges for nights past the actual checkout.
    const roomNightCharges = reservation.folio!.charges
      .filter((c) => c.type === "ROOM_NIGHT" && !c.voided)
      .sort((a, b) => (a.night?.getTime() ?? 0) - (b.night?.getTime() ?? 0));
    for (let i = actualNights; i < roomNightCharges.length; i++) {
      await tx.folioCharge.update({
        where: { id: roomNightCharges[i].id },
        data: {
          voided: true,
          voidReason: "Early departure",
          voidedAt: now,
          voidedById: auth.id,
        },
      });
    }
    // Add charges for any extra nights (extension at checkout).
    const rate = Number(reservation.nightlyRate);
    for (let i = roomNightCharges.length; i < actualNights; i++) {
      const night = new Date(reservation.checkInDate);
      night.setUTCDate(night.getUTCDate() + i);
      await tx.folioCharge.create({
        data: {
          folioId: reservation.folio!.id,
          type: "ROOM_NIGHT",
          amount: rate,
          description: `Room ${reservation.room.number} — ${night.toISOString().slice(0, 10)} (extension)`,
          night,
          chargedById: auth.id,
        },
      });
    }
  });

  // Recompute balance after reconcile.
  const folioRefreshed = await db.folio.findUnique({
    where: { id: reservation.folio.id },
    include: { charges: true },
  });
  const balance = computeFolioBalance(
    (folioRefreshed?.charges ?? []).map((c) => ({
      amount: Number(c.amount),
      voided: c.voided,
    })),
    Number(reservation.folio.openingDeposit)
  );

  await db.$transaction(async (tx) => {
    await tx.folio.update({
      where: { id: reservation.folio!.id },
      data: {
        status: "SETTLED",
        settledAt: now,
        settledById: auth.id,
        settledMethod: paymentMethod,
        settledTotal: balance,
      },
    });
    await tx.reservation.update({
      where: { id: reservationId },
      data: { status: "CHECKED_OUT", checkedOutAt: now, checkOutDate: actualCheckOut },
    });
    await tx.room.update({
      where: { id: reservation.roomId },
      data: { status: "VACANT_DIRTY" },
    });
  });

  // Receipt email — best-effort. The receipt body lists every non-
  // voided charge with its amount, so the guest leaves with a clear
  // record matching the printed receipt the front desk hands them.
  if (reservation.guest.email) {
    const liveCharges = (folioRefreshed?.charges ?? []).filter((c) => !c.voided);
    const tpl = renderCheckOutReceiptEmail({
      hotelName: reservation.hotel.name,
      guestName: reservation.guest.name,
      roomNumber: reservation.room.number,
      checkInDate: reservation.checkInDate.toISOString().slice(0, 10),
      checkOutDate: actualCheckOut.toISOString().slice(0, 10),
      charges: liveCharges.map((c) => ({
        description: c.description,
        amount: Number(c.amount),
        type: c.type,
      })),
      total: balance,
      paymentMethod,
    });
    sendEmail({
      from: pickFromAddress(reservation.hotel.emailFrom),
      to: reservation.guest.email,
      bcc: reservation.hotel.notificationEmail || undefined,
      subject: tpl.subject,
      html: tpl.html,
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, settledTotal: balance });
}
