import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaffAuth } from "@/lib/api-auth";

/**
 * GET /api/hotel?slug=neom-dahab
 *
 * Two response shapes by auth:
 *
 *   - Unauthenticated (no x-staff-id, or x-staff-id from a non-
 *     hotel-staff role at this restaurant): returns ONLY the
 *     public-safe fields needed by the cashier presence check and
 *     by anyone deciding whether to render the Charge-to-Room
 *     button. Specifically: { hotel: { name, address, checkInTime,
 *     checkOutTime } | null }. Sensitive config (icalExportToken,
 *     emailFrom, notificationEmail, tourismTaxPercent, icalSyncs)
 *     is omitted.
 *
 *   - Authenticated as OWNER/FRONT_DESK at this restaurant: full
 *     hotel record so the Setup tab can render and edit settings.
 *
 * Why split here instead of adding a separate /api/hotel/admin
 * endpoint: the public callers already exist and we don't want to
 * change those URLs. The auth check is a few lines and the diff
 * is contained.
 */
export async function GET(request: NextRequest) {
  const slug = new URL(request.url).searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });

  const restaurant = await db.restaurant.findUnique({
    where: { slug },
    select: { id: true, name: true, hotel: true },
  });
  if (!restaurant) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!restaurant.hotel) return NextResponse.json({ hotel: null });

  // Decide whether the caller is allowed the full record.
  const staffId = request.headers.get("x-staff-id");
  let isAuthorizedAdmin = false;
  if (staffId) {
    const staff = await db.staff.findUnique({
      where: { id: staffId },
      select: { restaurantId: true, role: true, active: true },
    });
    if (
      staff?.active &&
      staff.restaurantId === restaurant.id &&
      (staff.role === "OWNER" || staff.role === "FRONT_DESK")
    ) {
      isAuthorizedAdmin = true;
    }
  }

  if (isAuthorizedAdmin) {
    return NextResponse.json({ hotel: restaurant.hotel });
  }

  // Public shape — strip the sensitive config fields. We deliberately
  // include `name`, `address`, `checkInTime`, `checkOutTime` because
  // the public-facing /book and the cashier badge legitimately need
  // them. Everything else is admin-only.
  const h = restaurant.hotel;
  return NextResponse.json({
    hotel: {
      name: h.name,
      address: h.address,
      checkInTime: h.checkInTime,
      checkOutTime: h.checkOutTime,
    },
  });
}

/**
 * POST /api/hotel — owner creates the hotel row for their restaurant.
 * One per restaurant; existing rows are updated (upsert).
 */
export async function POST(request: NextRequest) {
  const auth = await requireStaffAuth(request, ["OWNER"]);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const {
    name,
    address,
    checkInTime,
    checkOutTime,
    notificationEmail,
    emailFrom,
    tourismTaxPercent,
  } = body;
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  // iCal export tokens now live per-RoomType
  // (RoomType.icalExportToken). The legacy Hotel.icalExportToken
  // column is kept for backwards compatibility but no longer
  // generated or rotated here.
  const data = {
    name: name.trim(),
    address: address?.trim() || null,
    checkInTime: checkInTime || "14:00",
    checkOutTime: checkOutTime || "12:00",
    notificationEmail: notificationEmail?.trim() || null,
    emailFrom: emailFrom?.trim() || null,
    tourismTaxPercent:
      typeof tourismTaxPercent === "number" && tourismTaxPercent >= 0
        ? tourismTaxPercent
        : null,
  };

  const hotel = await db.hotel.upsert({
    where: { restaurantId: auth.restaurantId },
    create: { restaurantId: auth.restaurantId, ...data },
    update: data,
  });

  return NextResponse.json({ hotel });
}
