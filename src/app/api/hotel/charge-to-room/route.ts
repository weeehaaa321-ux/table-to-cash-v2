import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaffAuth } from "@/lib/api-auth";

/**
 * POST /api/hotel/charge-to-room
 * Body: { orderId, reservationId }
 *
 * Cafe → folio integration. The cashier picks "Charge to Room" at
 * settle time, looks up the active reservation by room number, and
 * confirms. This route:
 *   1) Comps any items on the Order whose MenuItem has
 *      complimentaryForHotelGuests=true (e.g. pool ticket included
 *      in the rate).
 *   2) Recomputes the Order total from the surviving items.
 *   3) Writes a FolioCharge of type FOOD or ACTIVITY (depends on
 *      Order.station; ACTIVITY for STATION=ACTIVITY, FOOD otherwise)
 *      against the matching folio.
 *   4) Stamps Order.paymentMethod=ROOM_CHARGE and Order.paidAt.
 *
 * The Order is now considered settled in the cafe ledger; the
 * actual cash collection happens later when the front desk settles
 * the folio at checkout.
 */
export async function POST(request: NextRequest) {
  const auth = await requireStaffAuth(request, ["OWNER", "FRONT_DESK", "CASHIER"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const { orderId, reservationId } = body;
  if (!orderId || !reservationId) {
    return NextResponse.json({ error: "orderId and reservationId required" }, { status: 400 });
  }

  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { menuItem: true } },
      restaurant: { select: { id: true } },
      session: true,
    },
  });
  if (!order || order.restaurantId !== auth.restaurantId) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.paidAt) {
    return NextResponse.json({ error: "Order already paid" }, { status: 409 });
  }

  const reservation = await db.reservation.findUnique({
    where: { id: reservationId },
    include: {
      hotel: { select: { restaurantId: true } },
      folio: true,
    },
  });
  if (!reservation || reservation.hotel.restaurantId !== auth.restaurantId) {
    return NextResponse.json({ error: "Reservation not found" }, { status: 404 });
  }
  if (reservation.status !== "CHECKED_IN") {
    return NextResponse.json(
      { error: "Reservation must be CHECKED_IN to accept room charges" },
      { status: 409 }
    );
  }
  if (!reservation.folio || reservation.folio.status !== "OPEN") {
    return NextResponse.json({ error: "Folio is not open" }, { status: 409 });
  }

  const now = new Date();
  const compReason = "Hotel inclusion";

  const result = await db.$transaction(async (tx) => {
    let chargeable = 0;
    let compedAny = false;

    for (const item of order.items) {
      if (item.cancelled || item.comped) continue;
      const isComplimentary = item.menuItem?.complimentaryForHotelGuests === true;
      const lineGross = Number(item.price) * item.quantity;
      if (isComplimentary) {
        await tx.orderItem.update({
          where: { id: item.id },
          data: {
            comped: true,
            compReason,
            compedBy: auth.id,
            compedAt: now,
          },
        });
        compedAny = true;
      } else {
        chargeable += lineGross;
      }
    }

    // Recompute Order.total: sum of surviving (non-cancelled,
    // non-comped) items minus existing discount, plus tip and
    // delivery fee. Mirrors the cashier's confirmPayRound logic but
    // on the per-order shape we already have.
    const newSubtotal = chargeable;
    const newTotal = Math.max(
      0,
      newSubtotal - Number(order.discount) + Number(order.tip) + Number(order.deliveryFee)
    );

    await tx.order.update({
      where: { id: orderId },
      data: {
        subtotal: newSubtotal,
        total: newTotal,
        paymentMethod: "ROOM_CHARGE",
        paidAt: now,
        status: "PAID",
      },
    });

    // If everything was complimentary, no folio line is needed —
    // the meal was on the house. Otherwise post a single charge.
    let charge: Awaited<ReturnType<typeof tx.folioCharge.create>> | null = null;
    if (newTotal > 0) {
      const chargeType = order.station === "ACTIVITY" ? "ACTIVITY" : "FOOD";
      const desc =
        order.station === "ACTIVITY"
          ? `Activities — order #${order.orderNumber}`
          : `Cafe — order #${order.orderNumber}`;
      charge = await tx.folioCharge.create({
        data: {
          folioId: reservation.folio!.id,
          type: chargeType,
          amount: newTotal,
          description: desc,
          orderId,
          chargedById: auth.id,
        },
      });
    }

    // Link the table session to the reservation (if not already) so
    // future rounds on this session keep showing the same room.
    if (order.session && order.session.reservationId !== reservationId) {
      await tx.tableSession.update({
        where: { id: order.session.id },
        data: { reservationId },
      });
    }

    return { charge, total: newTotal, compedAny };
  });

  return NextResponse.json({ ok: true, ...result });
}
