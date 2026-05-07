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
  if (!hotelId) return NextResponse.json({ roomTypes: [] });

  const roomTypes = await db.roomType.findMany({
    where: { hotelId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: { _count: { select: { rooms: true } } },
  });
  return NextResponse.json({ roomTypes });
}

export async function POST(request: NextRequest) {
  const auth = await requireStaffAuth(request, ["OWNER"]);
  if (auth instanceof NextResponse) return auth;

  const hotelId = await getHotelIdForStaff(auth.restaurantId);
  if (!hotelId) return NextResponse.json({ error: "No hotel configured" }, { status: 400 });

  const body = await request.json();
  const { id, name, description, capacity, baseRate, amenities, sortOrder } = body;
  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }
  if (typeof baseRate !== "number" || baseRate < 0) {
    return NextResponse.json({ error: "baseRate required" }, { status: 400 });
  }

  const data = {
    name: name.trim(),
    description: description?.trim() || null,
    capacity: Math.max(1, Number(capacity) || 2),
    baseRate,
    amenities: Array.isArray(amenities) ? amenities.filter((a) => typeof a === "string") : [],
    sortOrder: Number(sortOrder) || 0,
  };

  if (id) {
    const updated = await db.roomType.update({
      where: { id, hotelId },
      data,
    });
    return NextResponse.json({ roomType: updated });
  }

  const created = await db.roomType.create({ data: { ...data, hotelId } });
  return NextResponse.json({ roomType: created });
}

export async function DELETE(request: NextRequest) {
  const auth = await requireStaffAuth(request, ["OWNER"]);
  if (auth instanceof NextResponse) return auth;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const hotelId = await getHotelIdForStaff(auth.restaurantId);
  if (!hotelId) return NextResponse.json({ error: "No hotel" }, { status: 400 });

  // Prevent deleting room types with rooms attached. The owner has to
  // reassign or remove the rooms first.
  const roomCount = await db.room.count({ where: { roomTypeId: id, hotelId } });
  if (roomCount > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${roomCount} room(s) use this type. Reassign first.` },
      { status: 409 }
    );
  }

  await db.roomType.delete({ where: { id, hotelId } });
  return NextResponse.json({ ok: true });
}
