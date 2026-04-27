import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";
import { getShiftCount } from "@/lib/shifts";

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
    const realId = await useCases.schedule.resolveRestaurantId(restaurantId);
    if (!realId) return NextResponse.json([]);

    const from = new Date(Date.UTC(year, month - 1, 1));
    const to = new Date(Date.UTC(year, month, 1));

    const schedules = await useCases.schedule.listMonth({
      restaurantId: realId,
      from,
      to,
      staffId: staffId || undefined,
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
    const realId = await useCases.schedule.resolveRestaurantId(restaurantId);
    if (!realId) return NextResponse.json({ error: "Restaurant not found" }, { status: 400 });

    const staff = await useCases.schedule.getStaffRole(staffId);
    if (!staff) return NextResponse.json({ error: "Staff not found" }, { status: 404 });

    const max = getShiftCount(staff.role);
    if (shift < 1 || shift > max) {
      return NextResponse.json({ error: `Invalid shift. Allowed: 1-${max}` }, { status: 400 });
    }

    const dateObj = new Date(date + "T00:00:00Z");
    const entry = await useCases.schedule.upsert({
      staffId,
      date: dateObj,
      shift,
      restaurantId: realId,
    });

    useCases.schedule.invalidateSync(realId);
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
    await useCases.schedule.deleteByStaffDate(staffId, dateObj);
    if (restaurantId) {
      const realId = await useCases.schedule.resolveRestaurantId(restaurantId);
      if (realId) useCases.schedule.invalidateSync(realId);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Schedule delete failed:", err);
    return NextResponse.json({ error: "Failed to delete schedule" }, { status: 500 });
  }
}
