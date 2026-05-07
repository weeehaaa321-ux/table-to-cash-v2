import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaffAuth } from "@/lib/api-auth";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const auth = await requireStaffAuth(request, ["OWNER", "FRONT_DESK"]);
  if (auth instanceof NextResponse) return auth;

  const { roomId } = await params;
  const body = await request.json();
  const { status, notes, floor, number, roomTypeId } = body;

  const room = await db.room.findUnique({
    where: { id: roomId },
    select: { hotel: { select: { restaurantId: true } } },
  });
  if (!room || room.hotel.restaurantId !== auth.restaurantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  if (status) data.status = status;
  if (notes !== undefined) data.notes = notes?.trim() || null;
  if (floor !== undefined) data.floor = floor != null ? Number(floor) : null;
  if (number) data.number = String(number).trim();
  if (roomTypeId) data.roomTypeId = roomTypeId;

  const updated = await db.room.update({ where: { id: roomId }, data });
  return NextResponse.json({ room: updated });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const auth = await requireStaffAuth(request, ["OWNER"]);
  if (auth instanceof NextResponse) return auth;

  const { roomId } = await params;
  const room = await db.room.findUnique({
    where: { id: roomId },
    select: {
      hotel: { select: { restaurantId: true } },
      _count: { select: { reservations: true } },
    },
  });
  if (!room || room.hotel.restaurantId !== auth.restaurantId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (room._count.reservations > 0) {
    return NextResponse.json(
      { error: "Cannot delete: room has reservation history" },
      { status: 409 }
    );
  }

  await db.room.delete({ where: { id: roomId } });
  return NextResponse.json({ ok: true });
}
