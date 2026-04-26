import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

async function resolveRestaurantId(id: string): Promise<string | null> {
  if (!id) return null;
  if (id.startsWith("c") && id.length > 10) return id;
  const r = await db.restaurant.findUnique({
    where: { slug: id },
    select: { id: true },
  });
  return r?.id || null;
}

// GET — two shapes:
//   ?staffId=      → { open: { id, clockIn } | null } for that one staff member
//   ?restaurantId= → { openStaffIds: string[] } — everyone currently on the clock
// The restaurantId form powers the live "clocked-in" indicator in the
// owner dashboard without N+1 per-staff requests.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const staffId = url.searchParams.get("staffId") || "";
  const restaurantId = url.searchParams.get("restaurantId") || "";

  if (staffId) {
    const open = await db.staffShift.findFirst({
      where: { staffId, clockOut: null },
      orderBy: { clockIn: "desc" },
    });
    return NextResponse.json({
      open: open
        ? { id: open.id, clockIn: open.clockIn.toISOString() }
        : null,
    });
  }

  if (restaurantId) {
    const realId = await resolveRestaurantId(restaurantId);
    if (!realId) return NextResponse.json({ openStaffIds: [] });
    const opens = await db.staffShift.findMany({
      where: { restaurantId: realId, clockOut: null },
      select: { staffId: true },
    });
    return NextResponse.json({ openStaffIds: opens.map((o) => o.staffId) });
  }

  return NextResponse.json({ open: null });
}

// POST { staffId, action: "in" | "out" }
// "in" creates a new shift; refuses if one is already open.
// "out" closes the most recent open shift.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { staffId, action } = body as { staffId?: string; action?: "in" | "out" };
  if (!staffId || (action !== "in" && action !== "out")) {
    return NextResponse.json({ error: "staffId and action=in|out required" }, { status: 400 });
  }

  const staff = await db.staff.findUnique({
    where: { id: staffId },
    select: { id: true, restaurantId: true, name: true },
  });
  if (!staff) return NextResponse.json({ error: "Staff not found" }, { status: 404 });

  if (action === "in") {
    const existing = await db.staffShift.findFirst({
      where: { staffId, clockOut: null },
    });
    if (existing) {
      return NextResponse.json(
        { error: "ALREADY_CLOCKED_IN", openShiftId: existing.id },
        { status: 409 },
      );
    }
    const shift = await db.staffShift.create({
      data: { staffId, restaurantId: staff.restaurantId },
    });
    return NextResponse.json({ success: true, id: shift.id, clockIn: shift.clockIn.toISOString() });
  }

  // action === "out"
  const open = await db.staffShift.findFirst({
    where: { staffId, clockOut: null },
    orderBy: { clockIn: "desc" },
  });
  if (!open) {
    return NextResponse.json({ error: "NOT_CLOCKED_IN" }, { status: 409 });
  }
  const closed = await db.staffShift.update({
    where: { id: open.id },
    data: { clockOut: new Date() },
  });
  const minutes = Math.round((closed.clockOut!.getTime() - closed.clockIn.getTime()) / 60000);
  return NextResponse.json({
    success: true,
    id: closed.id,
    clockIn: closed.clockIn.toISOString(),
    clockOut: closed.clockOut!.toISOString(),
    minutes,
  });
}

// PUT — owner report: list shifts in a date range.
// Body: { restaurantId, from, to }
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { restaurantId, from, to } = body as {
    restaurantId?: string;
    from?: string;
    to?: string;
  };
  if (!restaurantId || !from || !to) {
    return NextResponse.json({ error: "restaurantId, from, to required" }, { status: 400 });
  }
  const realId = await resolveRestaurantId(restaurantId);
  if (!realId) return NextResponse.json({ shifts: [] });

  const shifts = await db.staffShift.findMany({
    where: {
      restaurantId: realId,
      clockIn: { gte: new Date(from + "T00:00:00.000Z"), lte: new Date(to + "T23:59:59.999Z") },
    },
    orderBy: { clockIn: "desc" },
  });

  const staffIds = Array.from(new Set(shifts.map((s) => s.staffId)));
  const staff = await db.staff.findMany({
    where: { id: { in: staffIds } },
    select: { id: true, name: true, role: true },
  });
  const byId = new Map(staff.map((s) => [s.id, s]));

  return NextResponse.json({
    shifts: shifts.map((s) => {
      const member = byId.get(s.staffId);
      const minutes = s.clockOut
        ? Math.round((s.clockOut.getTime() - s.clockIn.getTime()) / 60000)
        : null;
      return {
        id: s.id,
        staffId: s.staffId,
        staffName: member?.name || "—",
        role: member?.role || "—",
        clockIn: s.clockIn.toISOString(),
        clockOut: s.clockOut?.toISOString() || null,
        minutes,
      };
    }),
  });
}
