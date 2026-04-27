import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";
import { transferWaiterSessions } from "@/lib/waiter-transfer";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { staffId, restaurantId } = body;

  if (!staffId || !restaurantId) {
    return NextResponse.json({ error: "staffId and restaurantId required" }, { status: 400 });
  }

  try {
    const realId = await useCases.staffManagement.resolveRestaurantId(restaurantId);
    if (!realId) {
      return NextResponse.json({ error: "Restaurant not found" }, { status: 400 });
    }

    const staffRow = await useCases.staffManagement.findRoleById(staffId);

    await useCases.staffManagement.deactivateOnEndShift(staffId, {
      setDeliveryOffline: staffRow?.role === "DELIVERY",
    });
    await useCases.staffManagement.closeOpenStaffShifts(staffId);

    if (staffRow?.role === "CASHIER") {
      const openSettlements = await useCases.staffManagement.listOpenSettlementsForCashier(staffId, realId);
      if (openSettlements.length === 0) {
        return NextResponse.json({ success: true, transferred: 0, newCashierId: null });
      }

      const otherCashiers = await useCases.staffManagement.listOtherActiveCashiers(realId, staffId);
      if (otherCashiers.length === 0) {
        return NextResponse.json({
          success: true,
          transferred: 0,
          newCashierId: null,
          warning: `${openSettlements.length} open settlement${openSettlements.length > 1 ? "s" : ""} — no active cashiers to take over`,
        });
      }

      const counts = await useCases.staffManagement.openSettlementCountsByCashier(
        realId,
        otherCashiers.map((c) => c.id),
      );
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

      await useCases.staffManagement.reassignSettlements(
        openSettlements.map((s) => s.id),
        targetCashier,
      );

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
