import { NextRequest, NextResponse } from "next/server";
import { legacyDb as db } from "@/infrastructure/composition";
import { getCurrentShift } from "@/lib/shifts";
import { computeSessionRounds } from "@/lib/session-rounds";
import { nowInRestaurantTz } from "@/lib/restaurant-config";
import { toNum } from "@/lib/money";

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

// Compute shift start time in UTC
function getShiftStart(shift: number): Date {
  const now = new Date();
  const cairoNow = nowInRestaurantTz(now);
  const offset = now.getTime() - cairoNow.getTime();
  const today = new Date(cairoNow.getFullYear(), cairoNow.getMonth(), cairoNow.getDate());
  const shiftStartHour = (shift - 1) * 8;
  return new Date(today.getTime() + shiftStartHour * 3600000 + offset);
}

// Guard: only run reassignment once per shift per restaurant
const lastReassignShift = new Map<string, number>();

// GET: All sessions for a restaurant — current shift + today
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const restaurantId = url.searchParams.get("restaurantId") || "";

  if (!restaurantId) {
    return NextResponse.json({ sessions: [], currentShift: getCurrentShift() });
  }

  try {
    const realId = await resolveRestaurantId(restaurantId);
    if (!realId) return NextResponse.json({ sessions: [], currentShift: getCurrentShift() });

    const currentShift = getCurrentShift();
    const shiftStart = getShiftStart(currentShift);

    // Auto-reassign only runs once per shift change (guarded in live-snapshot)
    // Kept here as a fallback for direct callers, but guarded the same way.
    if (lastReassignShift.get(realId) !== currentShift) {
      lastReassignShift.set(realId, currentShift);

      const openSessions = await db.tableSession.findMany({
        where: { restaurantId: realId, status: "OPEN", waiterId: { not: null } },
        include: { waiter: { select: { id: true, shift: true } } },
      });

      const newShiftWaiters = await db.staff.findMany({
        where: { restaurantId: realId, role: "WAITER", active: true, shift: { in: [currentShift, 0] } },
        orderBy: { createdAt: "asc" },
      });

      if (newShiftWaiters.length > 0) {
        let assignIdx = 0;
        for (const sess of openSessions) {
          const waiterShift = sess.waiter?.shift || 0;
          if (waiterShift !== 0 && waiterShift !== currentShift) {
            const newWaiter = newShiftWaiters[assignIdx % newShiftWaiters.length];
            await db.tableSession.update({
              where: { id: sess.id },
              data: { waiterId: newWaiter.id },
            });
            assignIdx++;
          }
        }
      }
    }

    // Fetch: all OPEN sessions (regardless of day) + today's closed sessions
    const cairoNow = nowInRestaurantTz();
    const todayStartCairo = new Date(cairoNow.getFullYear(), cairoNow.getMonth(), cairoNow.getDate());
    const offset = new Date().getTime() - cairoNow.getTime();
    const todayStartUTC = new Date(todayStartCairo.getTime() + offset);

    const sessions = await db.tableSession.findMany({
      where: {
        restaurantId: realId,
        OR: [
          { status: "OPEN" },                          // all open sessions carry over
          { closedAt: { gte: todayStartUTC } },        // today's closed sessions
        ],
      },
      include: {
        table: { select: { number: true } },
        waiter: { select: { id: true, name: true } },
        vipGuest: { select: { name: true } },
        orders: {
          select: { id: true, orderNumber: true, total: true, status: true, paymentMethod: true, paidAt: true },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { openedAt: "desc" },
    });

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
        // Delta the cashier still has to collect (excludes already-settled
        // and cancelled orders). Mirrors /api/live-snapshot so all consumers
        // see the same unpaid balance.
        unpaidTotal: s.orders
          .filter((o) => o.status !== "CANCELLED" && o.paidAt == null)
          .reduce((sum, o) => sum + toNum(o.total), 0),
        cashTotal: s.orders.filter((o) => o.paymentMethod === "CASH").reduce((sum, o) => sum + toNum(o.total), 0),
        // Payment is considered received once the cashier has confirmed
        // (paidAt stamped) on every non-cancelled order. The session may
        // still be OPEN because the kitchen hasn't finished cooking.
        // Cashier is single source of truth — a guest tapping Pay only
        // records paymentMethod, it does not flip this flag.
        paymentReceived:
          s.orders.length > 0 &&
          s.orders.every((o) => o.status === "CANCELLED" || o.paidAt != null),
        paidRounds: computeSessionRounds(s.orders.map((o) => ({ ...o, total: toNum(o.total) }))),
        isCurrentShift: new Date(s.openedAt) >= shiftStart,
      })),
    });
  } catch (err) {
    console.error("Failed to fetch sessions:", err);
    return NextResponse.json({ sessions: [], currentShift: getCurrentShift() });
  }
}
