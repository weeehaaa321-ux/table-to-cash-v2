import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { canLoginNow } from "@/lib/shifts";
import { nowInRestaurantTz } from "@/lib/restaurant-config";
import bcrypt from "bcryptjs";

// Resolve restaurantId — could be a slug or a cuid
async function resolveRestaurantId(id: string): Promise<string | null> {
  if (!id) return null;
  if (id.startsWith("c") && id.length > 10) return id;
  const restaurant = await db.restaurant.findUnique({
    where: { slug: id },
    select: { id: true },
  });
  return restaurant?.id || null;
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { pin, restaurantId } = body;

  if (!pin || !restaurantId) {
    return NextResponse.json({ error: "pin and restaurantId are required" }, { status: 400 });
  }

  try {
    const realId = await resolveRestaurantId(restaurantId);
    if (!realId) {
      return NextResponse.json({ error: "Restaurant not found" }, { status: 400 });
    }

    // Fetch all active staff for this restaurant and compare PIN hashes
    const allStaff = await db.staff.findMany({
      where: { restaurantId: realId, active: true },
      select: { id: true, name: true, role: true, shift: true, pin: true },
    });

    let staff: { id: string; name: string; role: string; shift: number } | null = null;
    for (const s of allStaff) {
      const isHashed = s.pin.startsWith("$2a$") || s.pin.startsWith("$2b$");
      let match = false;
      if (isHashed) {
        match = await bcrypt.compare(pin, s.pin);
      } else {
        // Legacy plain-text PIN — compare directly, then hash it for next time
        match = pin === s.pin;
        if (match) {
          const hashed = await bcrypt.hash(pin, 10);
          await db.staff.update({ where: { id: s.id }, data: { pin: hashed } }).catch(() => {});
        }
      }
      if (match) {
        staff = { id: s.id, name: s.name, role: s.role, shift: s.shift };
        break;
      }
    }

    if (!staff) {
      return NextResponse.json({ error: "Invalid PIN" }, { status: 401 });
    }

    // Sync shift from today's schedule if it differs
    let effectiveShift = staff.shift;
    if (staff.role !== "OWNER") {
      const now = nowInRestaurantTz();
      const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const todayStart = new Date(todayStr + "T00:00:00Z");
      const tomorrow = new Date(todayStart);
      tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
      const schedule = await db.shiftSchedule.findFirst({
        where: { staffId: staff.id, date: { gte: todayStart, lt: tomorrow } },
        select: { shift: true },
      });
      if (schedule && schedule.shift !== staff.shift) {
        await db.staff.update({ where: { id: staff.id }, data: { shift: schedule.shift } });
        effectiveShift = schedule.shift;
      }
    }

    // Enforce shift-based login restrictions (WAITER/CASHIER: 15min early, KITCHEN: 1hr early)
    if (staff.role !== "OWNER" && effectiveShift !== 0) {
      const check = canLoginNow(effectiveShift, staff.role);
      if (!check.allowed) {
        return NextResponse.json({ error: check.reason }, { status: 403 });
      }
    }

    return NextResponse.json({ ...staff, shift: effectiveShift });
  } catch (err) {
    console.error("Staff login failed:", err);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
