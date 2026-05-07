import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaffAuth } from "@/lib/api-auth";
import { syncAllForHotel, IcalSyncEntry } from "@/lib/hotel-ical-sync";

async function getHotel(restaurantId: string) {
  return db.hotel.findUnique({
    where: { restaurantId },
    select: { id: true, icalSyncs: true },
  });
}

/** GET — list configured iCal feeds + their last-sync state. */
export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request, ["OWNER", "FRONT_DESK"]);
  if (auth instanceof NextResponse) return auth;

  const hotel = await getHotel(auth.restaurantId);
  if (!hotel) return NextResponse.json({ entries: [] });

  return NextResponse.json({
    entries: (hotel.icalSyncs as IcalSyncEntry[] | null) || [],
  });
}

/** POST — replace the full list of iCal feeds. The admin UI sends
 *  the entire array; this endpoint validates and stores it. Persisted
 *  metadata (lastSyncedAt, etc.) is preserved for entries whose
 *  url+source+roomNumber match what's already there. */
export async function POST(request: NextRequest) {
  const auth = await requireStaffAuth(request, ["OWNER"]);
  if (auth instanceof NextResponse) return auth;

  const hotel = await getHotel(auth.restaurantId);
  if (!hotel) return NextResponse.json({ error: "No hotel" }, { status: 400 });

  const body = await request.json();
  const incoming: IcalSyncEntry[] = Array.isArray(body.entries) ? body.entries : [];

  const validSources = ["BOOKING_COM", "AIRBNB", "OTHER"];
  const cleaned: IcalSyncEntry[] = [];
  for (const e of incoming) {
    if (!e || typeof e.url !== "string" || !e.url.trim()) continue;
    if (!validSources.includes(e.source)) continue;
    if (typeof e.roomNumber !== "string" || !e.roomNumber.trim()) continue;
    cleaned.push({
      source: e.source,
      url: e.url.trim(),
      roomNumber: e.roomNumber.trim(),
    });
  }

  // Preserve sync state from existing entries that match by
  // (source, roomNumber, url) so editing the list doesn't lose
  // everyone's lastSyncedAt timestamp.
  const existing = (hotel.icalSyncs as IcalSyncEntry[] | null) || [];
  const merged = cleaned.map((e) => {
    const prior = existing.find(
      (x) =>
        x.source === e.source &&
        x.url === e.url &&
        x.roomNumber === e.roomNumber
    );
    if (prior) {
      return {
        ...e,
        lastSyncedAt: prior.lastSyncedAt,
        lastError: prior.lastError,
        reservationsCreated: prior.reservationsCreated,
      };
    }
    return e;
  });

  await db.hotel.update({
    where: { restaurantId: auth.restaurantId },
    data: { icalSyncs: merged as object },
  });
  return NextResponse.json({ entries: merged });
}

/** PUT — manual "Sync now" trigger. Runs the sync for all configured
 *  feeds and returns the counts. */
export async function PUT(request: NextRequest) {
  const auth = await requireStaffAuth(request, ["OWNER", "FRONT_DESK"]);
  if (auth instanceof NextResponse) return auth;

  const hotel = await getHotel(auth.restaurantId);
  if (!hotel) return NextResponse.json({ error: "No hotel" }, { status: 400 });

  const result = await syncAllForHotel(hotel.id);
  return NextResponse.json(result);
}
