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

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request, ["OWNER", "FRONT_DESK", "CASHIER"]);
  if (auth instanceof NextResponse) return auth;

  const hotelId = await getHotelIdForStaff(auth.restaurantId);
  if (!hotelId) return NextResponse.json({ rooms: [] });

  const rooms = await db.room.findMany({
    where: { hotelId },
    include: { roomType: true },
    orderBy: { number: "asc" },
  });
  return NextResponse.json({ rooms });
}

export async function POST(request: NextRequest) {
  const auth = await requireStaffAuth(request, ["OWNER"]);
  if (auth instanceof NextResponse) return auth;

  const hotelId = await getHotelIdForStaff(auth.restaurantId);
  if (!hotelId) return NextResponse.json({ error: "No hotel configured" }, { status: 400 });

  const body = await request.json();
  const { id, number, roomTypeId, floor, status, notes } = body;
  if (typeof number !== "string" || !number.trim()) {
    return NextResponse.json({ error: "number required" }, { status: 400 });
  }
  if (!roomTypeId) {
    return NextResponse.json({ error: "roomTypeId required" }, { status: 400 });
  }

  const data = {
    number: number.trim(),
    roomTypeId,
    floor: floor != null ? Number(floor) : null,
    status: status || "VACANT_CLEAN",
    notes: notes?.trim() || null,
  };

  if (id) {
    const updated = await db.room.update({
      where: { id, hotelId },
      data,
    });
    return NextResponse.json({ room: updated });
  }

  try {
    const created = await db.room.create({ data: { ...data, hotelId } });
    return NextResponse.json({ room: created });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to create";
    if (msg.includes("Unique constraint")) {
      return NextResponse.json({ error: `Room number "${number}" already exists` }, { status: 409 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
