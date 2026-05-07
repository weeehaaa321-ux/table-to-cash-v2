import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaffAuth } from "@/lib/api-auth";

/**
 * POST /api/hotel/folios/[folioId]/charge
 * Manual charge entry — typically minibar, room damage, late checkout
 * fee, etc. Cafe and activity charges go through /charge-to-room
 * which links back to an Order; this endpoint is for ad-hoc lines.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ folioId: string }> }
) {
  const auth = await requireStaffAuth(request, ["OWNER", "FRONT_DESK"]);
  if (auth instanceof NextResponse) return auth;

  const { folioId } = await params;
  const body = await request.json();
  const { type, amount, description } = body;

  if (!type || typeof amount !== "number" || !description?.trim()) {
    return NextResponse.json(
      { error: "type, amount, description required" },
      { status: 400 }
    );
  }
  const allowedTypes = ["MINIBAR", "MISC", "ACTIVITY", "FOOD"];
  if (!allowedTypes.includes(type)) {
    return NextResponse.json({ error: "invalid type" }, { status: 400 });
  }

  // Authz: folio belongs to a reservation at this restaurant.
  const folio = await db.folio.findUnique({
    where: { id: folioId },
    include: {
      reservation: { include: { hotel: { select: { restaurantId: true } } } },
    },
  });
  if (!folio || folio.reservation.hotel.restaurantId !== auth.restaurantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (folio.status !== "OPEN") {
    return NextResponse.json({ error: "Folio is not open" }, { status: 409 });
  }

  const charge = await db.folioCharge.create({
    data: {
      folioId,
      type,
      amount,
      description: description.trim(),
      chargedById: auth.id,
    },
  });
  return NextResponse.json({ charge });
}

/**
 * DELETE — void a charge (preserves audit trail with voided=true).
 * Body: { chargeId, reason }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ folioId: string }> }
) {
  const auth = await requireStaffAuth(request, ["OWNER", "FRONT_DESK"]);
  if (auth instanceof NextResponse) return auth;

  const { folioId } = await params;
  const body = await request.json();
  const { chargeId, reason } = body;
  if (!chargeId) return NextResponse.json({ error: "chargeId required" }, { status: 400 });

  const charge = await db.folioCharge.findUnique({
    where: { id: chargeId },
    include: {
      folio: {
        include: {
          reservation: { include: { hotel: { select: { restaurantId: true } } } },
        },
      },
    },
  });
  if (
    !charge ||
    charge.folioId !== folioId ||
    charge.folio.reservation.hotel.restaurantId !== auth.restaurantId
  ) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.folioCharge.update({
    where: { id: chargeId },
    data: {
      voided: true,
      voidReason: reason?.trim() || null,
      voidedAt: new Date(),
      voidedById: auth.id,
    },
  });
  return NextResponse.json({ ok: true });
}
