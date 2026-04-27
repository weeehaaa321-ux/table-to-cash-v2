import { NextRequest, NextResponse } from "next/server";
import { legacyDb as db } from "@/infrastructure/composition";
import { transferWaiterSessions } from "@/lib/waiter-transfer";

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

// POST: End a staff member's shift.
// For waiters, transfer their open tables to another active waiter.
// For other roles, just deactivate.
// Body: { staffId, restaurantId }
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { staffId, restaurantId } = body;

  if (!staffId || !restaurantId) {
    return NextResponse.json({ error: "staffId and restaurantId required" }, { status: 400 });
  }

  try {
    const realId = await resolveRestaurantId(restaurantId);
    if (!realId) {
      return NextResponse.json({ error: "Restaurant not found" }, { status: 400 });
    }

    // Look up role before deactivating
    const staffRow = await db.staff.findUnique({
      where: { id: staffId },
      select: { role: true },
    });

    // Deactivate the staff member (and set delivery drivers offline)
    await db.staff.update({
      where: { id: staffId },
      data: {
        active: false,
        ...(staffRow?.role === "DELIVERY" ? { deliveryOnline: false } : {}),
      },
    });

    // Close any open StaffShift rows so hours reports stay accurate.
    // Without this, ending a shift without clocking out leaves a dangling
    // open record that the clock log would render as "on shift" forever.
    await db.staffShift.updateMany({
      where: { staffId, clockOut: null },
      data: { clockOut: new Date() },
    });

    // Cashiers: reassign any open cash settlements (REQUESTED / ACCEPTED)
    // to another active cashier so they don't strand on an inactive staff row.
    if (staffRow?.role === "CASHIER") {
      const openSettlements = await db.cashSettlement.findMany({
        where: {
          cashierId: staffId,
          restaurantId: realId,
          status: { in: ["REQUESTED", "ACCEPTED"] },
        },
        select: { id: true },
      });

      if (openSettlements.length === 0) {
        return NextResponse.json({ success: true, transferred: 0, newCashierId: null });
      }

      const otherCashiers = await db.staff.findMany({
        where: { restaurantId: realId, role: "CASHIER", active: true, id: { not: staffId } },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true },
      });

      if (otherCashiers.length === 0) {
        return NextResponse.json({
          success: true,
          transferred: 0,
          newCashierId: null,
          warning: `${openSettlements.length} open settlement${openSettlements.length > 1 ? "s" : ""} — no active cashiers to take over`,
        });
      }

      // Pick cashier with fewest open settlements for basic load-balancing.
      const counts = await db.cashSettlement.groupBy({
        by: ["cashierId"],
        where: {
          restaurantId: realId,
          cashierId: { in: otherCashiers.map((c) => c.id) },
          status: { in: ["REQUESTED", "ACCEPTED"] },
        },
        _count: true,
      });
      const countMap = new Map<string, number>();
      for (const c of otherCashiers) countMap.set(c.id, 0);
      for (const row of counts) {
        if (row.cashierId) countMap.set(row.cashierId, row._count);
      }
      let targetCashier = otherCashiers[0];
      let minCount = Infinity;
      for (const c of otherCashiers) {
        const n = countMap.get(c.id) || 0;
        if (n < minCount) { minCount = n; targetCashier = c; }
      }

      await db.cashSettlement.updateMany({
        where: { id: { in: openSettlements.map((s) => s.id) } },
        data: { cashierId: targetCashier.id, cashierName: targetCashier.name },
      });

      try {
        const { sendPushToStaff } = await import("@/lib/web-push");
        await sendPushToStaff(targetCashier.id, {
          title: "Settlements Transferred",
          body: `${openSettlements.length} open cash settlement${openSettlements.length > 1 ? "s" : ""} reassigned to you from a shift change`,
          tag: `settle-transfer-${Date.now()}`,
          url: "/cashier",
        });
      } catch { /* push not critical */ }

      return NextResponse.json({
        success: true,
        transferred: openSettlements.length,
        newCashierId: targetCashier.id,
        newCashierName: targetCashier.name,
      });
    }

    // Other non-waiter roles (KITCHEN, BAR): just deactivate.
    if (staffRow?.role !== "WAITER") {
      return NextResponse.json({ success: true, transferred: 0, newWaiterId: null });
    }

    const result = await transferWaiterSessions(staffId, realId);
    return NextResponse.json({
      success: true,
      ...result,
      ...(result.newWaiterId === null && result.transferred > 0
        ? { warning: "No active waiters available" }
        : {}),
    });
  } catch (err) {
    console.error("End shift failed:", err);
    return NextResponse.json({ error: "Failed to end shift" }, { status: 500 });
  }
}
