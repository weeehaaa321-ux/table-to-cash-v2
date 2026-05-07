import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaffAuth } from "@/lib/api-auth";

async function getHotelIdForStaff(restaurantId: string) {
  const hotel = await db.hotel.findUnique({
    where: { restaurantId },
    select: { id: true },
  });
  return hotel?.id ?? null;
}

/**
 * GET /api/hotel/guests?q=...
 * Search guests by name, phone, or ID number. Used by the booking
 * form to look up returning guests before creating a new row.
 */
export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request, ["OWNER", "FRONT_DESK"]);
  if (auth instanceof NextResponse) return auth;

  const hotelId = await getHotelIdForStaff(auth.restaurantId);
  if (!hotelId) return NextResponse.json({ guests: [] });

  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  if (!q) {
    const recent = await db.guest.findMany({
      where: { hotelId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    return NextResponse.json({ guests: recent });
  }

  const guests = await db.guest.findMany({
    where: {
      hotelId,
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { phone: { contains: q } },
        { idNumber: { contains: q, mode: "insensitive" } },
      ],
    },
    take: 30,
  });
  return NextResponse.json({ guests });
}

export async function POST(request: NextRequest) {
  const auth = await requireStaffAuth(request, ["OWNER", "FRONT_DESK"]);
  if (auth instanceof NextResponse) return auth;

  const hotelId = await getHotelIdForStaff(auth.restaurantId);
  if (!hotelId) return NextResponse.json({ error: "No hotel" }, { status: 400 });

  const body = await request.json();
  const {
    id,
    name,
    phone,
    email,
    idNumber,
    nationality,
    address,
    dateOfBirth,
    notes,
  } = body;
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  const data = {
    name: name.trim(),
    phone: phone?.trim() || null,
    email: email?.trim() || null,
    idNumber: idNumber?.trim() || null,
    nationality: nationality?.trim() || null,
    address: address?.trim() || null,
    dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
    notes: notes?.trim() || null,
  };

  if (id) {
    const updated = await db.guest.update({
      where: { id, hotelId },
      data,
    });
    return NextResponse.json({ guest: updated });
  }

  const created = await db.guest.create({ data: { ...data, hotelId } });
  return NextResponse.json({ guest: created });
}
