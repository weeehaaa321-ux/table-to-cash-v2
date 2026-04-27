import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";
import { toNum } from "@/lib/money";

function getShiftStart(shift: number): Date {
  const now = new Date();
  const cairoNow = useCases.sessions.nowInTz();
  const offset = now.getTime() - cairoNow.getTime();
  const today = new Date(cairoNow.getFullYear(), cairoNow.getMonth(), cairoNow.getDate());
  const shiftStartHour = (shift - 1) * 8;
  return new Date(today.getTime() + shiftStartHour * 3600000 + offset);
}

const lastReassignShift = new Map<string, number>();

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const restaurantId = url.searchParams.get("restaurantId") || "";
  const currentShift = useCases.sessions.currentShift();

  if (!restaurantId) {
    return NextResponse.json({ sessions: [], currentShift });
  }

  try {
    const realId = await useCases.sessions.resolveRestaurantId(restaurantId);
    if (!realId) return NextResponse.json({ sessions: [], currentShift });

    const shiftStart = getShiftStart(currentShift);

    if (lastReassignShift.get(realId) !== currentShift) {
      lastReassignShift.set(realId, currentShift);
      const openSessions = await useCases.sessions.listOpenWithWaiterShift(realId);
      const newShiftWaiters = await useCases.sessions.listWaitersOnShifts(realId, [currentShift, 0]);
      if (newShiftWaiters.length > 0) {
        let assignIdx = 0;
        for (const sess of openSessions) {
          const waiterShift = sess.waiter?.shift || 0;
          if (waiterShift !== 0 && waiterShift !== currentShift) {
            const newWaiter = newShiftWaiters[assignIdx % newShiftWaiters.length];
            await useCases.sessions.assignWaiter(sess.id, newWaiter.id);
            assignIdx++;
          }
        }
      }
    }

    const cairoNow = useCases.sessions.nowInTz();
    const todayStartCairo = new Date(cairoNow.getFullYear(), cairoNow.getMonth(), cairoNow.getDate());
    const offset = new Date().getTime() - cairoNow.getTime();
    const todayStartUTC = new Date(todayStartCairo.getTime() + offset);

    const sessions = await useCases.sessions.listOpenAndTodayClosed(realId, todayStartUTC);

    return NextResponse.json({
      currentShift,
      shiftStart: shiftStart.toISOString(),
      sessions: sessions.map((s) => ({
        id: s.id,
        tableNumber: s.table?.number ?? null,
        orderType: s.orderType ?? "TABLE",
        vipGuestName: s.vipGuest?.name ?? null,
        guestCount: s.guestCount,
        waiterId: s.waiterId,
        waiterName: s.waiter?.name || null,
        openedAt: s.openedAt.toISOString(),
        menuOpenedAt: s.menuOpenedAt?.toISOString() || null,
        closedAt: s.closedAt?.toISOString() || null,
        status: s.status,
        orderCount: s.orders.filter((o) => o.status !== "CANCELLED").length,
        orderTotal: s.orders.filter((o) => o.status !== "CANCELLED").reduce((sum, o) => sum + toNum(o.total), 0),
        unpaidTotal: s.orders
          .filter((o) => o.status !== "CANCELLED" && o.paidAt == null)
          .reduce((sum, o) => sum + toNum(o.total), 0),
        cashTotal: s.orders.filter((o) => o.paymentMethod === "CASH").reduce((sum, o) => sum + toNum(o.total), 0),
        paymentReceived:
          s.orders.length > 0 &&
          s.orders.every((o) => o.status === "CANCELLED" || o.paidAt != null),
        paidRounds: useCases.sessions.computeRounds(
          s.orders.map((o) => ({ ...o, total: toNum(o.total) })),
        ),
        isCurrentShift: new Date(s.openedAt) >= shiftStart,
      })),
    });
  } catch (err) {
    console.error("Failed to fetch sessions:", err);
    return NextResponse.json({ sessions: [], currentShift });
  }
}
