import { db } from "@/lib/db";
import { parseEvents } from "@/lib/ical";

export type IcalSyncEntry = {
  source: "BOOKING_COM" | "AIRBNB" | "OTHER";
  url: string;
  roomNumber: string;
  lastSyncedAt?: string;
  lastError?: string;
  reservationsCreated?: number;
};

/**
 * Sync a single iCal feed. Fetches, parses VEVENTs, upserts
 * reservations against the externalUid+icalSync pair so a re-sync
 * doesn't create duplicates. Returns metrics for the admin UI.
 *
 * Behaviour:
 *   - VEVENT.STATUS = CANCELLED -> mark our reservation CANCELLED
 *     if it exists, otherwise skip.
 *   - Existing reservation with same externalUid: update dates.
 *   - New event: create a placeholder Guest ("Booking.com guest" or
 *     "Airbnb guest") and a Reservation with source=BOOKING_COM/AIRBNB.
 *     Front desk replaces the placeholder with real guest details
 *     when the guest arrives.
 */
export async function syncIcalEntry(
  hotelId: string,
  entry: IcalSyncEntry
): Promise<{ created: number; updated: number; cancelled: number; skipped: number }> {
  const room = await db.room.findFirst({
    where: { hotelId, number: entry.roomNumber },
    include: { roomType: true },
  });
  if (!room) {
    throw new Error(`Room ${entry.roomNumber} not found`);
  }

  const res = await fetch(entry.url, {
    headers: { "User-Agent": "NeomApp/1.0 (+ical)" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  const text = await res.text();
  const events = parseEvents(text);

  let created = 0;
  let updated = 0;
  let cancelled = 0;
  let skipped = 0;

  for (const event of events) {
    // Skip events with no real date range. Some OTAs emit zero-length
    // "blocked" markers; ignore them.
    if (event.start.getTime() === event.end.getTime()) {
      skipped++;
      continue;
    }

    const existing = await db.reservation.findFirst({
      where: { hotelId, externalUid: event.uid },
    });

    if (event.status === "CANCELLED") {
      if (existing && existing.status !== "CANCELLED") {
        await db.reservation.update({
          where: { id: existing.id },
          data: {
            status: "CANCELLED",
            cancelledAt: new Date(),
            cancelReason: `OTA cancellation (${entry.source})`,
          },
        });
        cancelled++;
      } else {
        skipped++;
      }
      continue;
    }

    if (existing) {
      // Only update if dates actually changed; spare ourselves a no-op
      // write on every re-sync.
      const dateChanged =
        existing.checkInDate.getTime() !== event.start.getTime() ||
        existing.checkOutDate.getTime() !== event.end.getTime();
      if (dateChanged) {
        await db.reservation.update({
          where: { id: existing.id },
          data: {
            checkInDate: event.start,
            checkOutDate: event.end,
          },
        });
        updated++;
      } else {
        skipped++;
      }
      continue;
    }

    // New booking from the OTA. Placeholder guest — front desk
    // overwrites the name when they arrive. Internal note records
    // what we know from the iCal feed (the SUMMARY usually says
    // something like "CLOSED - Booking.com booking" with no PII).
    const placeholderName =
      entry.source === "BOOKING_COM"
        ? "Booking.com guest"
        : entry.source === "AIRBNB"
        ? "Airbnb guest"
        : "OTA guest";

    await db.$transaction(async (tx) => {
      const guest = await tx.guest.create({
        data: {
          hotelId,
          name: placeholderName,
          notes: `Imported from ${entry.source}. Replace with real guest details on arrival.`,
        },
      });
      const reservation = await tx.reservation.create({
        data: {
          hotelId,
          guestId: guest.id,
          roomId: room.id,
          checkInDate: event.start,
          checkOutDate: event.end,
          nightlyRate: Number(room.roomType.baseRate),
          adults: 2,
          source: entry.source,
          status: "BOOKED",
          externalUid: event.uid,
          internalNotes: event.summary || null,
        },
      });
      await tx.folio.create({
        data: { reservationId: reservation.id },
      });
    });
    created++;
  }

  return { created, updated, cancelled, skipped };
}

/**
 * Sync every configured iCal feed for a hotel. Persists per-feed
 * status (lastSyncedAt, lastError, reservationsCreated) back to
 * Hotel.icalSyncs JSON. Errors on individual feeds don't abort the
 * sweep — the bad URL just gets its lastError stamped, the others
 * still run.
 */
export async function syncAllForHotel(hotelId: string): Promise<{
  totalCreated: number;
  totalUpdated: number;
  totalCancelled: number;
  errors: number;
}> {
  const hotel = await db.hotel.findUnique({
    where: { id: hotelId },
    select: { icalSyncs: true },
  });
  const entries: IcalSyncEntry[] = (hotel?.icalSyncs as IcalSyncEntry[] | null) || [];
  if (entries.length === 0) {
    return { totalCreated: 0, totalUpdated: 0, totalCancelled: 0, errors: 0 };
  }

  let totalCreated = 0;
  let totalUpdated = 0;
  let totalCancelled = 0;
  let errors = 0;
  const updatedEntries: IcalSyncEntry[] = [];

  for (const entry of entries) {
    try {
      const r = await syncIcalEntry(hotelId, entry);
      totalCreated += r.created;
      totalUpdated += r.updated;
      totalCancelled += r.cancelled;
      updatedEntries.push({
        ...entry,
        lastSyncedAt: new Date().toISOString(),
        lastError: undefined,
        reservationsCreated:
          (entry.reservationsCreated || 0) + r.created,
      });
    } catch (e) {
      errors++;
      updatedEntries.push({
        ...entry,
        lastSyncedAt: new Date().toISOString(),
        lastError: e instanceof Error ? e.message : String(e),
      });
    }
  }

  await db.hotel.update({
    where: { id: hotelId },
    data: { icalSyncs: updatedEntries as object },
  });

  return { totalCreated, totalUpdated, totalCancelled, errors };
}
