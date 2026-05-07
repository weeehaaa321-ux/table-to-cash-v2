import { db } from "@/lib/db";

/**
 * Returns the Hotel row for a given Restaurant slug, or null if no
 * hotel module is configured for that property. The cafe code uses
 * this to decide whether to surface "Charge to Room" in the cashier
 * payment flow.
 */
export async function getHotelByRestaurantSlug(slug: string) {
  const restaurant = await db.restaurant.findUnique({
    where: { slug },
    select: { id: true, hotel: true },
  });
  if (!restaurant) return null;
  return restaurant.hotel;
}

/**
 * Returns true if a guest at the given table session is also a hotel
 * guest with an active stay (CHECKED_IN). Used by the cashier UI to
 * decide whether to render the "Charge to Room" button.
 */
export async function isSessionEligibleForRoomCharge(sessionId: string) {
  const session = await db.tableSession.findUnique({
    where: { id: sessionId },
    select: {
      reservationId: true,
      reservation: { select: { status: true } },
    },
  });
  if (!session?.reservationId || !session.reservation) return false;
  return session.reservation.status === "CHECKED_IN";
}

/**
 * Inclusive count of nights between checkInDate and checkOutDate.
 * Both arguments are local-midnight Date objects (Prisma @db.Date).
 * A 2026-05-10 → 2026-05-13 booking returns 3.
 */
export function countNights(checkInDate: Date, checkOutDate: Date): number {
  const ms = checkOutDate.getTime() - checkInDate.getTime();
  return Math.max(0, Math.round(ms / (24 * 60 * 60 * 1000)));
}

type RateRoomType = {
  baseRate: number | string | { toString(): string };
  weekendRate: number | string | { toString(): string } | null;
};

/**
 * Returns the rate for a single night. The "night" is identified by
 * its check-in date — i.e. the night of 2026-05-10 starts on the
 * evening of May 10. In Egypt the weekend is Friday + Saturday, so
 * those check-in dates pull the weekendRate when set.
 */
export function rateForNight(roomType: RateRoomType, night: Date): number {
  const dow = night.getUTCDay(); // 0=Sun, 5=Fri, 6=Sat
  const isWeekend = dow === 5 || dow === 6;
  const weekend = roomType.weekendRate != null ? Number(roomType.weekendRate) : null;
  if (isWeekend && weekend != null && weekend > 0) return weekend;
  return Number(roomType.baseRate);
}

/**
 * Total stay cost given a room type and a date range, walking
 * each night and applying the rate for that night. Returns:
 *   { total, perNight: [{date, rate}, ...] }
 * Used by /book to show the right total upfront and by check-in
 * to post the right ROOM_NIGHT charges.
 */
export function computeStayCost(
  roomType: RateRoomType,
  checkIn: Date,
  checkOut: Date
): { total: number; perNight: Array<{ date: Date; rate: number }> } {
  const nights = countNights(checkIn, checkOut);
  const perNight: Array<{ date: Date; rate: number }> = [];
  let total = 0;
  for (let i = 0; i < nights; i++) {
    const date = new Date(checkIn);
    date.setUTCDate(date.getUTCDate() + i);
    const rate = rateForNight(roomType, date);
    perNight.push({ date, rate });
    total += rate;
  }
  return { total, perNight };
}

/**
 * Sum of non-voided charges minus opening deposit. Negative numbers
 * (credits) net out as expected. Used at folio detail and at settle.
 */
export function computeFolioBalance(
  charges: Array<{ amount: number | string | { toString(): string }; voided: boolean }>,
  openingDeposit: number | string | { toString(): string } = 0
): number {
  const total = charges.reduce((acc, c) => {
    if (c.voided) return acc;
    return acc + Number(c.amount);
  }, 0);
  return total - Number(openingDeposit);
}

/**
 * Returns the rooms that are free for the entire requested date
 * range. A room is "occupied" for a date range if any non-cancelled
 * reservation overlaps. Used by the booking form and walk-in flow.
 */
export async function findAvailableRooms(
  hotelId: string,
  checkInDate: Date,
  checkOutDate: Date,
  options?: { excludeReservationId?: string }
) {
  const allRooms = await db.room.findMany({
    where: { hotelId, status: { not: "MAINTENANCE" } },
    include: { roomType: true },
    orderBy: { number: "asc" },
  });

  const conflicts = await db.reservation.findMany({
    where: {
      hotelId,
      status: { in: ["BOOKED", "CHECKED_IN"] },
      ...(options?.excludeReservationId
        ? { id: { not: options.excludeReservationId } }
        : {}),
      AND: [
        { checkInDate: { lt: checkOutDate } },
        { checkOutDate: { gt: checkInDate } },
      ],
    },
    select: { roomId: true },
  });

  const blocked = new Set(conflicts.map((c) => c.roomId));
  return allRooms.filter((r) => !blocked.has(r.id));
}
