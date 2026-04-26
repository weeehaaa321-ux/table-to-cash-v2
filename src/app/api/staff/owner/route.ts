import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") || "";

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const owner = await db.staff.findUnique({
    where: { id },
    select: { id: true, name: true, role: true },
  });

  if (!owner || owner.role !== "OWNER") {
    return NextResponse.json({ error: "Owner not found" }, { status: 404 });
  }

  return NextResponse.json({ id: owner.id, name: owner.name });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, name, currentPin, newPin } = body;

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  try {
    const owner = await db.staff.findUnique({
      where: { id },
      select: { id: true, pin: true, role: true, restaurantId: true },
    });

    if (!owner || owner.role !== "OWNER") {
      return NextResponse.json({ error: "Owner not found" }, { status: 404 });
    }

    const data: Record<string, unknown> = {};

    if (name !== undefined && name.trim()) {
      data.name = name.trim();
    }

    if (newPin !== undefined) {
      if (!currentPin) {
        return NextResponse.json({ error: "Current PIN required to change PIN" }, { status: 400 });
      }
      if (newPin.length < 4 || newPin.length > 6 || !/^\d+$/.test(newPin)) {
        return NextResponse.json({ error: "New PIN must be 4-6 digits" }, { status: 400 });
      }

      const isHashed = owner.pin.startsWith("$2a$") || owner.pin.startsWith("$2b$");
      const pinMatch = isHashed
        ? await bcrypt.compare(currentPin, owner.pin)
        : currentPin === owner.pin;

      if (!pinMatch) {
        return NextResponse.json({ error: "Current PIN is incorrect" }, { status: 403 });
      }

      const others = await db.staff.findMany({
        where: { restaurantId: owner.restaurantId, id: { not: id } },
        select: { pin: true },
      });
      for (const s of others) {
        const h = s.pin.startsWith("$2a$") || s.pin.startsWith("$2b$");
        const dup = h ? await bcrypt.compare(newPin, s.pin) : newPin === s.pin;
        if (dup) {
          return NextResponse.json({ error: "PIN already in use by another staff member" }, { status: 409 });
        }
      }

      data.pin = await bcrypt.hash(newPin, 10);
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const updated = await db.staff.update({
      where: { id },
      data,
      select: { id: true, name: true },
    });

    return NextResponse.json(updated);
  } catch (err) {
    console.error("Owner update failed:", err);
    return NextResponse.json({ error: "Failed to update owner" }, { status: 500 });
  }
}
