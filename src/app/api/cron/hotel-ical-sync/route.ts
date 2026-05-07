import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { syncAllForHotel } from "@/lib/hotel-ical-sync";

/**
 * GET /api/cron/hotel-ical-sync
 * Vercel cron target. Walks every hotel that has at least one iCal
 * feed configured and syncs it. Authentication via the standard
 * CRON_SECRET header that other crons in this repo use.
 *
 * Expected schedule: every 30 minutes is plenty for OTA sync (most
 * platforms only refresh their iCal output every 15-60 min anyway).
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization") || "";
  // Default-deny: refuse if CRON_SECRET isn't configured. Matches the
  // pattern other crons in this repo use; closes the "anyone with the
  // URL can trigger" gap that existed when the env var was missing.
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Find every hotel with non-empty icalSyncs JSON. We scan all hotels
  // and filter in JS — JSON predicates work in Prisma for top-level
  // shapes but Json[] checks are awkward, and the count is tiny.
  const hotels = await db.hotel.findMany({
    select: { id: true, name: true, icalSyncs: true },
  });

  type R = {
    hotelId: string;
    name: string;
    created: number;
    updated: number;
    cancelled: number;
    errors: number;
  };
  const results: R[] = [];
  for (const hotel of hotels) {
    const list = (hotel.icalSyncs as unknown[] | null) || [];
    if (list.length === 0) continue;
    try {
      const r = await syncAllForHotel(hotel.id);
      results.push({
        hotelId: hotel.id,
        name: hotel.name,
        created: r.totalCreated,
        updated: r.totalUpdated,
        cancelled: r.totalCancelled,
        errors: r.errors,
      });
    } catch (e) {
      console.error(`hotel-ical-sync failed for ${hotel.id}:`, e);
      results.push({
        hotelId: hotel.id,
        name: hotel.name,
        created: 0,
        updated: 0,
        cancelled: 0,
        errors: 1,
      });
    }
  }

  return NextResponse.json({ ok: true, results });
}
