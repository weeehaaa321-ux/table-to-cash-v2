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
  const body = await request.json().catch(() => ({}));
  // Allow the front desk to assign a specific room at check-in for
  // type-bound reservations (the typical flow for OTA + direct
  // bookings). Walk-ins arrive with a roomId already set.
  const assignedRoomId: string | undefined = body.roomId;

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
      roomType: true,
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

  // Resolve the physical room to assign. Three valid cases:
  //   (a) reservation.roomId already set (walk-in or admin pre-pick).
  //   (b) front desk passes roomId in the request body to assign now.
  //   (c) Auto-pick the first free room of the booked type if neither
  //       is provided — covers the common case of OTA bookings where
  //       the front desk just clicks "check in" without thinking
  //       about which physical room.
  let roomId: string | null = reservation.roomId;
  let roomTypeForRate = reservation.room?.roomType ?? reservation.roomType;
  let roomNumber = reservation.room?.number ?? "TBD";

  if (!roomId && assignedRoomId) {
    const candidate = await db.room.findUnique({
      where: { id: assignedRoomId },
      include: { roomType: true },
    });
    if (
      !candidate ||
      candidate.hotelId !== reservation.hotelId ||
      candidate.roomTypeId !== reservation.roomTypeId
    ) {
      return NextResponse.json(
        { error: "Picked room is not in this reservation's type" },
        { status: 400 }
      );
    }
    roomId = candidate.id;
    roomTypeForRate = candidate.roomType;
    roomNumber = candidate.number;
  } else if (!roomId) {
    // Auto-pick: first room of the booked type currently VACANT_CLEAN.
    const free = await db.room.findFirst({
      where: {
        hotelId: reservation.hotelId,
        roomTypeId: reservation.roomTypeId,
        status: "VACANT_CLEAN",
      },
      include: { roomType: true },
      orderBy: { number: "asc" },
    });
    if (!free) {
      return NextResponse.json(
        {
          error:
            "No clean rooms of the booked type are ready. Flip a dirty room to clean first or pick a specific room.",
        },
        { status: 409 }
      );
    }
    roomId = free.id;
    roomTypeForRate = free.roomType;
    roomNumber = free.number;
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
      data: {
        status: "CHECKED_IN",
        checkedInAt: new Date(),
        stayToken,
        roomId,
      },
    });
    if (roomId) {
      await tx.room.update({
        where: { id: roomId },
        data: { status: "OCCUPIED" },
      });
    }

    // Post one ROOM_NIGHT charge per booked night. The night field
    // stores the check-in side of each night (so a 5/10–5/13 stay
    // produces three rows: 5/10, 5/11, 5/12). Rate uses the room
    // type's weekendRate when the night falls on Fri/Sat.
    for (let i = 0; i < nights; i++) {
      const night = new Date(reservation.checkInDate);
      night.setUTCDate(night.getUTCDate() + i);
      const nightlyRate = rateForNight(roomTypeForRate, night);
      const isWeekend = night.getUTCDay() === 5 || night.getUTCDay() === 6;
      await tx.folioCharge.create({
        data: {
          folioId: reservation.folio!.id,
          type: "ROOM_NIGHT",
          amount: nightlyRate,
          description: `Room ${roomNumber} — ${night.toISOString().slice(0, 10)}${isWeekend && roomTypeForRate.weekendRate ? " (weekend rate)" : ""}`,
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
      roomNumber,
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
