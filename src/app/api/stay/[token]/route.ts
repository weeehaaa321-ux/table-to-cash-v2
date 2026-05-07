import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/stay/[token]
 * Public endpoint — token is the auth. Returns just the data the
 * guest needs to see their own stay: name, room, dates, folio
 * charges, balance, hotel name. Does NOT return staff PII or
 * other reservations.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) return NextResponse.json({ error: "missing token" }, { status: 400 });

  const reservation = await db.reservation.findUnique({
    where: { stayToken: token },
    select: {
      status: true,
      checkInDate: true,
      checkOutDate: true,
      checkedInAt: true,
      checkedOutAt: true,
      adults: true,
      children: true,
      specialRequests: true,
      guest: { select: { name: true } },
      room: {
        select: { number: true, roomType: { select: { name: true } } },
      },
      hotel: {
        select: {
          name: true,
          checkOutTime: true,
          restaurant: { select: { instapayHandle: true, instapayPhone: true } },
        },
      },
      folio: {
        select: {
          status: true,
          openingDeposit: true,
          settledTotal: true,
          settledAt: true,
          settledMethod: true,
          charges: {
            where: { voided: false },
            select: {
              type: true,
              amount: true,
              description: true,
              chargedAt: true,
              night: true,
            },
            orderBy: { chargedAt: "asc" },
          },
        },
      },
    },
  });

  if (!reservation) {
    return NextResponse.json({ error: "Stay not found" }, { status: 404 });
  }

  // Compute balance the same way the admin does. Negative = credit.
  const sum = (reservation.folio?.charges || []).reduce(
    (acc, c) => acc + Number(c.amount),
    0
  );
  const balance = sum - Number(reservation.folio?.openingDeposit || 0);

  return NextResponse.json({
    reservation,
    balance,
  });
}
