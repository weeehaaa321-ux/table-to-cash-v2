// Migrated to layered architecture. Behavior + request/response shapes
// byte-identical to source. presentation → application → infrastructure.

import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";
import { makeId } from "@/domain/shared/Identifier";

// Live clock-state polls — never cache. Stale responses make the
// dashboard's "clocked-in" bulbs lag behind reality (the symptom
// previously fixed only by a hard page refresh).
const NO_STORE = { "Cache-Control": "no-store, must-revalidate" } as const;

// GET ?staffId= → { open: { id, clockIn } | null }
// GET ?restaurantId= → { openStaffIds: [...] }
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const staffId = url.searchParams.get("staffId") || "";
  const restaurantId = url.searchParams.get("restaurantId") || "";

  if (staffId) {
    const open = await useCases.clockInOut.getOpenForStaff(makeId<"Staff">(staffId));
    return NextResponse.json(
      {
        open: open ? { id: open.id, clockIn: open.clockIn.toISOString() } : null,
      },
      { headers: NO_STORE },
    );
  }
  if (restaurantId) {
    const openStaffIds = await useCases.clockInOut.listOpenStaffIds();
    return NextResponse.json({ openStaffIds }, { headers: NO_STORE });
  }
  return NextResponse.json({ open: null }, { headers: NO_STORE });
}

// POST { staffId, action: "in" | "out" }
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { staffId, action } = body as { staffId?: string; action?: "in" | "out" };
  if (!staffId || (action !== "in" && action !== "out")) {
    return NextResponse.json({ error: "staffId and action=in|out required" }, { status: 400 });
  }

  const staff = await useCases.staffManagement.findById(staffId);
  if (!staff) return NextResponse.json({ error: "Staff not found" }, { status: 404 });

  if (action === "in") {
    const result = await useCases.clockInOut.clockIn(makeId<"Staff">(staffId));
    if (!result.ok) {
      return NextResponse.json(
        { error: "ALREADY_CLOCKED_IN", openShiftId: result.openShiftId },
        { status: 409 },
      );
    }
    return NextResponse.json({
      success: true,
      id: result.shift.id,
      clockIn: result.shift.clockIn.toISOString(),
    });
  }

  const result = await useCases.clockInOut.clockOut(makeId<"Staff">(staffId));
  if (!result.ok) return NextResponse.json({ error: "NOT_CLOCKED_IN" }, { status: 409 });
  return NextResponse.json({
    success: true,
    id: result.shift.id,
    clockIn: result.shift.clockIn.toISOString(),
    clockOut: result.shift.clockOut!.toISOString(),
    minutes: result.durationMinutes,
  });
}

// PUT { restaurantId, from, to } — owner shift report
export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { restaurantId, from, to } = body as { restaurantId?: string; from?: string; to?: string };
  if (!restaurantId || !from || !to) {
    return NextResponse.json({ error: "restaurantId, from, to required" }, { status: 400 });
  }

  const shifts = await useCases.clockInOut.listInRange(
    new Date(from + "T00:00:00.000Z"),
    new Date(to + "T23:59:59.999Z"),
  );

  const staffIds = Array.from(new Set(shifts.map((s) => s.staffId)));
  const staff = await useCases.staffManagement.listByIds(staffIds);
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
