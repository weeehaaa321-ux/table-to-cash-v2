import { db } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Acquire a transaction-scoped Postgres advisory lock for a (hotel,
 * room type) pair. Pass any tx (a Prisma transactional client) and
 * call this BEFORE the availability check. The lock auto-releases
 * when the transaction commits or rolls back; concurrent callers
 * for the same key serialise on the lock — closing the TOCTOU
 * window between availability check and reservation insert.
 *
 * Two-int form: pg_advisory_xact_lock(int4, int4). We hash the
 * two ids into 32-bit ints. Low collision probability per hotel
 * (small N of types) is fine — at worst an unrelated lock waits
 * a moment.
 */
export async function lockTypePool(
  tx: Prisma.TransactionClient,
  hotelId: string,
  roomTypeId: string
): Promise<void> {
  // FNV-1a-ish 32-bit hash. Stable, fast, dependency-free.
  function hash32(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    }
    // Coerce to signed int32 for Postgres int4.
    return h | 0;
  }
  const a = hash32(`hotel:${hotelId}`);
  const b = hash32(`type:${roomTypeId}`);
  await tx.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(${a}, ${b})`);
}

/**
 * Same shape but locked at the hotel level, used by the iCal sync
 * mutex so cron + manual "Sync now" can't race for the same hotel.
 */
export async function lockHotel(
  tx: Prisma.TransactionClient,
  hotelId: string
): Promise<void> {
  function hash32(s: string): number {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    }
    return h | 0;
  }
  // Use a different first arg from the type-pool lock so the two
  // never collide. 0x484F5445 = "HOTE" — stable namespace marker.
  const a = 0x484f5445 | 0;
  const b = hash32(`hotel:${hotelId}`);
  await tx.$queryRawUnsafe(`SELECT pg_advisory_xact_lock(${a}, ${b})`);
}

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

/**
 * Returns the start of "today" in Africa/Cairo as a UTC Date.
 *
 * Why this exists: our @db.Date columns and most date math used to
 * use UTC midnight, which means between 12am and 2am Cairo (UTC+2)
 * the "today" view was still showing yesterday. This helper computes
 * the UTC instant that corresponds to local midnight in Cairo.
 *
 * Cairo currently doesn't observe DST so the offset is a fixed +2h,
 * but Egypt has flipped DST policy multiple times historically. We
 * use Intl to be future-proof.
 */
export function cairoMidnightUtc(reference?: Date): Date {
  const now = reference ?? new Date();
  // Format in Cairo time and parse back. The trick: we want the UTC
  // instant that PRINTS as 00:00 local. Intl.DateTimeFormat does the
  // tz conversion, then we shift by the offset.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const localDate = fmt.format(now); // "2026-05-07"
  // Build a Date at UTC midnight of that local date, then back-shift
  // by the Cairo offset to get the UTC instant of local midnight.
  const utcMidOfLocalDate = new Date(`${localDate}T00:00:00Z`);
  // Compute the offset between Cairo time and UTC at this moment.
  // Use a sentinel UTC time to read the local equivalent, then diff.
  const probeUtc = new Date(`${localDate}T12:00:00Z`);
  const probeLocalParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    hour: "2-digit",
    hour12: false,
  }).format(probeUtc);
  const localHourAtNoonUtc = parseInt(probeLocalParts, 10);
  // Cairo is UTC+2 currently → at 12:00 UTC, local is 14:00 →
  // offsetHours = 2. If a future DST shift happens this self-adjusts.
  const offsetHours = localHourAtNoonUtc - 12;
  return new Date(utcMidOfLocalDate.getTime() - offsetHours * 60 * 60 * 1000);
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
 * reservation overlaps. Used by the booking form when the front
 * desk wants to assign a specific room (advanced flow). The
 * standard /book + iCal flow uses the type-level availability below.
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
      roomId: { not: null },
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

  const blocked = new Set(conflicts.map((c) => c.roomId).filter(Boolean) as string[]);
  return allRooms.filter((r) => !blocked.has(r.id));
}

/**
 * Type-level availability — the OTA-native primary path. Returns
 * one entry per room type with how many physical rooms of that
 * type remain free for the entire requested range, given:
 *   - the inventory of rooms of that type (excluding MAINTENANCE),
 *   - reservations bound to a specific room (roomId set),
 *   - reservations bound only to a type (roomId null — typical for
 *     OTA + direct bookings until check-in).
 *
 * Conservative on overlaps: if a type-bound reservation could
 * possibly take any of the type's rooms, we count it as -1 free
 * for the entire range.
 *
 * This is what /book uses to render real availability and what the
 * iCal export uses to decide which nights are "BUSY" for OTAs.
 */
export async function findAvailableRoomTypes(
  hotelId: string,
  checkInDate: Date,
  checkOutDate: Date,
  options?: { excludeReservationId?: string }
): Promise<
  Array<{
    id: string;
    name: string;
    description: string | null;
    capacity: number;
    baseRate: number;
    weekendRate: number | null;
    minNights: number;
    amenities: string[];
    inventory: number;
    booked: number;
    available: number;
  }>
> {
  // Pull every room type + its inventory (excluding MAINTENANCE).
  const types = await db.roomType.findMany({
    where: { hotelId },
    include: {
      rooms: {
        where: { status: { not: "MAINTENANCE" } },
        select: { id: true },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  // All overlapping non-cancelled reservations.
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
    select: { roomTypeId: true, roomId: true },
  });

  return types.map((t) => {
    const inventory = t.rooms.length;
    const booked = conflicts.filter((c) => c.roomTypeId === t.id).length;
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      capacity: t.capacity,
      baseRate: Number(t.baseRate),
      weekendRate: t.weekendRate != null ? Number(t.weekendRate) : null,
      minNights: t.minNights,
      amenities: t.amenities,
      inventory,
      booked,
      available: Math.max(0, inventory - booked),
    };
  });
}

/**
 * Per-night occupancy counts for a type, used by the iCal export.
 * Returns a Map<dateISO, { booked, inventory }> for every night in
 * the window. The export emits a BUSY event for any night where
 * booked >= inventory.
 */
export async function typeOccupancyByNight(
  hotelId: string,
  roomTypeId: string,
  rangeStart: Date,
  rangeEnd: Date
): Promise<Map<string, { booked: number; inventory: number }>> {
  const inventoryRooms = await db.room.count({
    where: { hotelId, roomTypeId, status: { not: "MAINTENANCE" } },
  });
  const reservations = await db.reservation.findMany({
    where: {
      hotelId,
      roomTypeId,
      status: { in: ["BOOKED", "CHECKED_IN"] },
      AND: [
        { checkInDate: { lt: rangeEnd } },
        { checkOutDate: { gt: rangeStart } },
      ],
    },
    select: { checkInDate: true, checkOutDate: true },
  });

  const out = new Map<string, { booked: number; inventory: number }>();
  // Initialize every night in the window with zero bookings.
  const cursor = new Date(rangeStart);
  while (cursor < rangeEnd) {
    const key = cursor.toISOString().slice(0, 10);
    out.set(key, { booked: 0, inventory: inventoryRooms });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  // For each reservation, mark each night it covers (inclusive of
  // checkInDate, exclusive of checkOutDate — the night of May 10
  // is covered by a 5/10–5/13 stay; the 5/13 night is not).
  for (const r of reservations) {
    const c = new Date(Math.max(r.checkInDate.getTime(), rangeStart.getTime()));
    const end = new Date(Math.min(r.checkOutDate.getTime(), rangeEnd.getTime()));
    while (c < end) {
      const key = c.toISOString().slice(0, 10);
      const cell = out.get(key);
      if (cell) cell.booked += 1;
      c.setUTCDate(c.getUTCDate() + 1);
    }
  }
  return out;
}
