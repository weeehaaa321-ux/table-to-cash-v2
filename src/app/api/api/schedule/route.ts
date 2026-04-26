import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getShiftCount } from "@/lib/shifts";
import { invalidateScheduleSync } from "@/lib/schedule-sync";

async function resolveRestaurantId(id: string): Promise<string | null> {
  if (!id) return null;
  if (id.startsWith("c") && id.length > 10) return id;
  const r = await db.restaurant.findUnique({
    where: { slug: id },
    select: { id: true },
  });
  return r?.id || null;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const restaurantId = url.searchParams.get("restaurantId") || "";
  const year = parseInt(url.searchParams.get("year") || "0", 10);
  const month = parseInt(url.searchParams.get("month") || "0", 10);
  const staffId = url.searchParams.get("staffId");

  if (!restaurantId || !year || !month) {
    return NextResponse.json({ error: "restaurantId, year, month required" }, { status: 400 });
  }

  try {
    const realId = await resolveRestaurantId(restaurantId);
    if (!realId) return NextResponse.json([]);

    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 1));

    const where: Record<string, unknown> = {
      restaurantId: realId,
      date: { gte: from, lt: to },
    };
    if (staffId) where.staffId = staffId;

    const schedules = await db.shiftSchedule.findMany({
      where,
      select: { id: true, staffId: true, date: true, shift: true },
      orderBy: { date: "asc" },
    });

    return NextResponse.json(schedules);
  } catch (err) {
    console.error("Schedule fetch failed:", err);
    return NextResponse.json({ error: "Failed to fetch schedule" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { staffId, date, shift, restaurantId } = body;

  if (!staffId || !date || !shift || !restaurantId) {
    return NextResponse.json({ error: "staffId, date, shift, restaurantId required" }, { status: 400 });
  }

  try {
    const realId = await resolveRestaurantId(restaurantId);
    if (!realId) return NextResponse.json({ error: "Restaurant not found" }, { status: 400 });

    const staff = await db.staff.findUnique({ where: { id: staffId }, select: { role: true } });
    if (!staff) return NextResponse.json({ error: "Staff not found" }, { status: 404 });

    const max = getShiftCount(staff.role);
    if (shift < 1 || shift > max) {
      return NextResponse.json({ error: `Invalid shift. Allowed: 1-${max}` }, { status: 400 });
    }

    const dateObj = new Date(date + "T00:00:00Z");
    const entry = await db.shiftSchedule.upsert({
      where: { staffId_date: { staffId, date: dateObj } },
      create: { staffId, date: dateObj, shift, restaurantId: realId },
      update: { shift },
    });

    invalidateScheduleSync(realId);
    return NextResponse.json(entry);
  } catch (err) {
    console.error("Schedule update failed:", err);
    return NextResponse.json({ error: "Failed to update schedule" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { staffId, date, restaurantId } = body;

  if (!staffId || !date) {
    return NextResponse.json({ error: "staffId and date required" }, { status: 400 });
  }

  try {
    const dateObj = new Date(date + "T00:00:00Z");
    await db.shiftSchedule.deleteMany({ where: { staffId, date: dateObj } });
    if (restaurantId) {
      const realId = await resolveRestaurantId(restaurantId);
      if (realId) invalidateScheduleSync(realId);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Schedule delete failed:", err);
    return NextResponse.json({ error: "Failed to delete schedule" }, { status: 500 });
  }
}
