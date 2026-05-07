import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { typeOccupancyByNight } from "@/lib/hotel";

/**
 * GET /api/ical/[hotelSlug]/[roomTypeSlug]?token=...
 *
 * Public iCalendar export. Returns one VEVENT per night where this
 * room type is fully booked. Owner pastes this URL into the
 * "Sync availability" / "iCal import" field on Booking.com,
 * Airbnb, Expedia, etc. extranets so they stop selling those
 * nights and won't double-book us.
 *
 * Auth: a PER-ROOM-TYPE token in the query string. The token must
 * match RoomType.icalExportToken (not Hotel.icalExportToken — that
 * field exists but is no longer used for export auth). Per-type
 * tokens mean a leaked URL only exposes one type's calendar, not
 * every channel for every room. Tokens are generated lazily on
 * first export request.
 *
 * The URL is the secret because OTAs don't let you customise
 * headers when configuring a calendar URL — they just GET it.
 *
 * Window: 18 months forward — enough for OTAs that look 6-12
 * months out without exporting our entire history.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ hotelSlug: string; roomTypeSlug: string }> }
) {
  const { hotelSlug, roomTypeSlug } = await params;
  const token = new URL(request.url).searchParams.get("token") || "";
  if (!token) {
    return new NextResponse("Missing token", { status: 401 });
  }

  // Resolve hotel by restaurant slug. We pull the room types so we
  // can match the URL slug; per-type token is checked once we've
  // identified the type.
  const restaurant = await db.restaurant.findUnique({
    where: { slug: hotelSlug },
    select: {
      hotel: {
        select: {
          id: true,
          name: true,
          roomTypes: {
            select: { id: true, name: true, icalExportToken: true },
          },
        },
      },
    },
  });
  if (!restaurant?.hotel) {
    return new NextResponse("Hotel not found", { status: 404 });
  }

  // Match room type by slug — we don't have a roomTypeSlug column,
  // so we slugify the name on the fly. Front-end gives the same
  // slug when generating the URL.
  const slugify = (s: string) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "");
  const matchedType = restaurant.hotel.roomTypes.find(
    (rt) => slugify(rt.name) === roomTypeSlug
  );
  if (!matchedType) {
    return new NextResponse("Room type not found", { status: 404 });
  }

  // Constant-time comparison would be ideal but the token is opaque
  // entropy; a simple === is fine here. Token MUST be set and match
  // — we don't fall back to a hotel-wide token any more.
  if (!matchedType.icalExportToken || matchedType.icalExportToken !== token) {
    return new NextResponse("Invalid token", { status: 401 });
  }

  // 18 months forward window.
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 18);

  const occupancy = await typeOccupancyByNight(
    restaurant.hotel.id,
    matchedType.id,
    start,
    end
  );

  // Group consecutive fully-booked nights into single VEVENTs to
  // keep the file small and OTA-friendly.
  type Block = { start: string; end: string };
  const blocks: Block[] = [];
  let runStart: string | null = null;
  let runLast: string | null = null;
  const sortedDates = [...occupancy.keys()].sort();
  for (const date of sortedDates) {
    const cell = occupancy.get(date)!;
    const fullyBooked = cell.inventory > 0 && cell.booked >= cell.inventory;
    if (fullyBooked) {
      if (runStart === null) {
        runStart = date;
        runLast = date;
      } else {
        runLast = date;
      }
    } else if (runStart !== null && runLast !== null) {
      const endDate = new Date(runLast);
      endDate.setUTCDate(endDate.getUTCDate() + 1);
      blocks.push({ start: runStart, end: endDate.toISOString().slice(0, 10) });
      runStart = null;
      runLast = null;
    }
  }
  if (runStart !== null && runLast !== null) {
    const endDate = new Date(runLast);
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    blocks.push({ start: runStart, end: endDate.toISOString().slice(0, 10) });
  }

  const compact = (s: string) => s.replace(/-/g, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//${restaurant.hotel.name}//Neom Hotel//EN`,
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${restaurant.hotel.name} — ${matchedType.name}`,
  ];
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  for (const b of blocks) {
    const uid = `block-${matchedType.id}-${b.start}@${hotelSlug}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(b.start)}`,
      `DTEND;VALUE=DATE:${compact(b.end)}`,
      `SUMMARY:CLOSED - Not available`,
      "STATUS:CONFIRMED",
      "TRANSP:OPAQUE",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");

  return new NextResponse(lines.join("\r\n") + "\r\n", {
    status: 200,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      // 5-minute cache — OTAs poll every 15-60 min, this lets fresh
      // bookings propagate quickly without us getting hammered.
      "Cache-Control": "public, max-age=300",
    },
  });
}
