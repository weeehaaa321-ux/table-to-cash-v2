import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { requireStaffAuth } from "@/lib/api-auth";
import { rateForNight } from "@/lib/hotel";
import {
  pickFromAddress,
  renderCheckInWelcomeEmail,
  sendEmail,
} from "@/lib/email";

// 18-char URL-safe token. Long enough to be unguessable in practice
// (108 bits of entropy) and short enough to print on a slip / QR
// without becoming an eyesore.
function generateStayToken(): string {
  return randomBytes(13).toString("base64url");
}

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
      hotel: {
        select: {
          restaurantId: true,
          name: true,
          checkOutTime: true,
          notificationEmail: true,
          emailFrom: true,
        },
      },
      folio: true,
      room: { include: { roomType: true } },
      guest: { select: { name: true, email: true } },
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

  // Per-night rate respecting weekend pricing on the room type. We
  // walk each night and pull the right rate, so a Thursday-Sunday
  // stay correctly bills the higher Fri/Sat rate without front desk
  // doing math.
  const nights = Math.round(
    (reservation.checkOutDate.getTime() - reservation.checkInDate.getTime()) /
      (24 * 60 * 60 * 1000)
  );

  // Generate the public stay token at check-in (not at booking
  // time). Front desk can show it on a printed slip or QR for the
  // guest's /stay/{token} page.
  const stayToken = reservation.stayToken || generateStayToken();

  await db.$transaction(async (tx) => {
    await tx.reservation.update({
      where: { id: reservationId },
      data: { status: "CHECKED_IN", checkedInAt: new Date(), stayToken },
    });
    await tx.room.update({
      where: { id: reservation.roomId },
      data: { status: "OCCUPIED" },
    });

    // Post one ROOM_NIGHT charge per booked night. The night field
    // stores the check-in side of each night (so a 5/10–5/13 stay
    // produces three rows: 5/10, 5/11, 5/12). Rate uses the room
    // type's weekendRate when the night falls on Fri/Sat.
    for (let i = 0; i < nights; i++) {
      const night = new Date(reservation.checkInDate);
      night.setUTCDate(night.getUTCDate() + i);
      const nightlyRate = rateForNight(reservation.room.roomType, night);
      const isWeekend = night.getUTCDay() === 5 || night.getUTCDay() === 6;
      await tx.folioCharge.create({
        data: {
          folioId: reservation.folio!.id,
          type: "ROOM_NIGHT",
          amount: nightlyRate,
          description: `Room ${reservation.room.number} — ${night.toISOString().slice(0, 10)}${isWeekend && reservation.room.roomType.weekendRate ? " (weekend rate)" : ""}`,
          night,
          chargedById: auth.id,
        },
      });
    }
  });

  // Welcome email with the stay link. Best-effort; failures don't
  // block check-in. Only sent if the guest gave us an email at
  // booking — walk-ins often don't.
  if (reservation.guest.email && process.env.NEXT_PUBLIC_BASE_URL) {
    const stayLink = `${process.env.NEXT_PUBLIC_BASE_URL.replace(/\/$/, "")}/stay/${stayToken}`;
    const tpl = renderCheckInWelcomeEmail({
      hotelName: reservation.hotel.name,
      guestName: reservation.guest.name,
      roomNumber: reservation.room.number,
      stayLink,
      checkOutDate: reservation.checkOutDate.toISOString().slice(0, 10),
      checkOutTime: reservation.hotel.checkOutTime,
    });
    sendEmail({
      from: pickFromAddress(reservation.hotel.emailFrom),
      to: reservation.guest.email,
      subject: tpl.subject,
      html: tpl.html,
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, stayToken });
}
