import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { findAvailableRooms, countNights, computeStayCost } from "@/lib/hotel";
import {
  pickFromAddress,
  renderBookingConfirmationEmail,
  sendEmail,
} from "@/lib/email";

/**
 * POST /api/book/reserve
 * Public direct-booking endpoint. Body:
 *   {
 *     slug, roomTypeId, from, to, adults, children?,
 *     guest: { name, phone, email?, idNumber?, nationality? },
 *     specialRequests?
 *   }
 *
 * Picks the FIRST available room of the requested type for the
 * requested range. Creates a Guest row (we don't dedupe — the same
 * person can land here twice without us linking them), creates the
 * Reservation in BOOKED state with source=DIRECT, and returns a
 * confirmation payload (reservation id + a confirmation token the
 * guest can use to view their booking later).
 *
 * Rate comes from the room type's published rate at booking time.
 * No PIN required — this is the public booking flow.
 */
export async function POST(request: NextRequest) {
  const body = await request.json();
  const {
    slug,
    roomTypeId,
    from,
    to,
    adults,
    children,
    guest,
    specialRequests,
  } = body;

  // Validation. Reject early so we don't half-create a Guest.
  if (!slug || !roomTypeId || !from || !to || !guest?.name?.trim()) {
    return NextResponse.json(
      { error: "slug, roomTypeId, from, to, and guest.name required" },
      { status: 400 }
    );
  }
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    return NextResponse.json({ error: "Invalid dates" }, { status: 400 });
  }
  if (countNights(fromDate, toDate) < 1) {
    return NextResponse.json(
      { error: "Check-out must be at least one night after check-in" },
      { status: 400 }
    );
  }
  // Reasonable hard ceiling; the public form shouldn't be a way to
  // hold every room for 10 years.
  if (countNights(fromDate, toDate) > 30) {
    return NextResponse.json(
      { error: "Maximum 30 nights per direct booking" },
      { status: 400 }
    );
  }

  const restaurant = await db.restaurant.findUnique({
    where: { slug },
    select: {
      hotel: {
        select: {
          id: true,
          name: true,
          checkInTime: true,
          checkOutTime: true,
          notificationEmail: true,
          emailFrom: true,
        },
      },
    },
  });
  if (!restaurant?.hotel) {
    return NextResponse.json({ error: "Hotel not found" }, { status: 404 });
  }
  const hotel = restaurant.hotel;
  const hotelId = hotel.id;

  const roomType = await db.roomType.findUnique({
    where: { id: roomTypeId },
    select: {
      id: true,
      name: true,
      baseRate: true,
      weekendRate: true,
      minNights: true,
      hotelId: true,
      capacity: true,
    },
  });
  if (!roomType || roomType.hotelId !== hotelId) {
    return NextResponse.json({ error: "Room type not found" }, { status: 404 });
  }

  // Minimum-stay enforcement: high-season blocks (Christmas etc.) are
  // configured by setting RoomType.minNights > 1. We reject early so
  // the guest sees a clear message instead of a generic failure.
  const nights = countNights(fromDate, toDate);
  if (nights < roomType.minNights) {
    return NextResponse.json(
      {
        error: `Minimum stay for ${roomType.name} is ${roomType.minNights} nights`,
      },
      { status: 400 }
    );
  }

  // Pick first available room of that type.
  const available = await findAvailableRooms(hotelId, fromDate, toDate);
  const candidate = available.find((r) => r.roomTypeId === roomTypeId);
  if (!candidate) {
    return NextResponse.json(
      { error: "No rooms of that type are available for the requested dates" },
      { status: 409 }
    );
  }

  const adultCount = Math.max(1, Math.min(roomType.capacity, Number(adults) || 2));
  const childCount = Math.max(0, Number(children) || 0);

  // Compute the actual total walking each night, applying weekendRate
  // where appropriate. We store the average rate on the reservation
  // for backward compatibility; check-in posts per-night ROOM_NIGHT
  // charges with the right per-night amount.
  const cost = computeStayCost(roomType, fromDate, toDate);
  const avgRate = nights > 0 ? cost.total / nights : Number(roomType.baseRate);

  // Same-transaction guest+reservation+folio create. Direct booking
  // never auto-checks-in — front desk verifies ID at arrival.
  const result = await db.$transaction(async (tx) => {
    const newGuest = await tx.guest.create({
      data: {
        hotelId,
        name: guest.name.trim(),
        phone: guest.phone?.trim() || null,
        email: guest.email?.trim() || null,
        idNumber: guest.idNumber?.trim() || null,
        nationality: guest.nationality?.trim() || null,
      },
    });
    const reservation = await tx.reservation.create({
      data: {
        hotelId,
        guestId: newGuest.id,
        roomId: candidate.id,
        checkInDate: fromDate,
        checkOutDate: toDate,
        nightlyRate: avgRate,
        adults: adultCount,
        children: childCount,
        source: "DIRECT",
        status: "BOOKED",
        specialRequests: specialRequests?.trim() || null,
        internalNotes: "Booked via public website form",
      },
    });
    await tx.folio.create({
      data: { reservationId: reservation.id },
    });
    return { guest: newGuest, reservation };
  });

  // Confirmation email — best-effort, doesn't block the booking on
  // an email failure. If RESEND_API_KEY isn't configured the helper
  // logs and no-ops, so this stays safe pre-launch.
  if (guest.email?.trim()) {
    const tpl = renderBookingConfirmationEmail({
      hotelName: hotel.name,
      guestName: guest.name,
      roomNumber: candidate.number,
      roomTypeName: roomType.name,
      checkInDate: from,
      checkOutDate: to,
      nights,
      totalEstimate: cost.total,
      bookingRef: result.reservation.id.slice(-10).toUpperCase(),
      checkInTime: hotel.checkInTime,
      checkOutTime: hotel.checkOutTime,
    });
    sendEmail({
      from: pickFromAddress(hotel.emailFrom),
      to: guest.email.trim(),
      bcc: hotel.notificationEmail || undefined,
      subject: tpl.subject,
      html: tpl.html,
    }).catch(() => {});
  } else if (hotel.notificationEmail) {
    // No guest email but the front desk still wants a heads-up.
    sendEmail({
      from: pickFromAddress(hotel.emailFrom),
      to: hotel.notificationEmail,
      subject: `New direct booking — ${guest.name}`,
      html: `<p>${guest.name} just booked Room ${candidate.number} for ${nights} night(s) (${from} → ${to}).</p>`,
    }).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    reservationId: result.reservation.id,
    roomNumber: candidate.number,
    nights,
    totalEstimate: cost.total,
  });
}
