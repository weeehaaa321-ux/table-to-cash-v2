import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { requireStaffAuth } from "@/lib/api-auth";

/**
 * GET — return the existing token (creating one if it doesn't exist
 * yet — lazy provision so the export URL is usable from the moment
 * the room type is set up).
 *
 * POST — explicitly rotate the token. Existing OTA URLs stop working;
 * owner has to update each.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roomTypeId: string }> }
) {
  const auth = await requireStaffAuth(request, ["OWNER", "FRONT_DESK"]);
  if (auth instanceof NextResponse) return auth;

  const { roomTypeId } = await params;
  const rt = await db.roomType.findUnique({
    where: { id: roomTypeId },
    select: {
      id: true,
      icalExportToken: true,
      hotel: { select: { restaurantId: true } },
    },
  });
  if (!rt || rt.hotel.restaurantId !== auth.restaurantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (rt.icalExportToken) {
    return NextResponse.json({ token: rt.icalExportToken });
  }
  const token = randomBytes(20).toString("base64url");
  await db.roomType.update({
    where: { id: rt.id },
    data: { icalExportToken: token },
  });
  return NextResponse.json({ token });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roomTypeId: string }> }
) {
  const auth = await requireStaffAuth(request, ["OWNER"]);
  if (auth instanceof NextResponse) return auth;

  const { roomTypeId } = await params;
  const rt = await db.roomType.findUnique({
    where: { id: roomTypeId },
    select: { id: true, hotel: { select: { restaurantId: true } } },
  });
  if (!rt || rt.hotel.restaurantId !== auth.restaurantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const token = randomBytes(20).toString("base64url");
  await db.roomType.update({
    where: { id: rt.id },
    data: { icalExportToken: token },
  });
  return NextResponse.json({ token });
}
