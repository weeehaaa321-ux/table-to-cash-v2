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

// NOTE: this endpoint used to run its own reassignment sweep on every
// poll. That logic now lives in /api/live-snapshot's reassignSweep,
// which every role page polls via useLiveData. Running it here too
// would just double the DB writes — the throttle in reassignSweep
// would dedupe the work, but the queries fire twice. Removed.

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

    const cairoNow = useCases.sessions.nowInTz();
    const todayStartCairo = new Date(cairoNow.getFullYear(), cairoNow.getMonth(), cairoNow.getDate());
    const offset = new Date().getTime() - cairoNow.getTime();
    const todayStartUTC = new Date(todayStartCairo.getTime() + offset);

    const sessions = await useCases.sessions.listOpenAndTodayClosed(realId, todayStartUTC);

    return NextResponse.json({
      currentShift,
      shiftStart: shiftStart.toISOString(),
      sessions: sessions.map((s) => {
        // Guest-side "I'm about to pay" signal: an unpaid order with a
        // paymentMethod stamped on it (set by /api/sessions/pay POST when
        // the guest taps Pay X EGP). The cashier reflects this back —
        // highlights the matching method, dims the rest, pre-fills tip.
        const pendingOrders = s.orders.filter(
          (o) => o.status !== "CANCELLED" && o.paidAt == null && o.paymentMethod != null,
        );
        const pendingMethod = (pendingOrders[0]?.paymentMethod ?? null) as
          | "CASH" | "CARD" | "INSTAPAY" | null;
        const pendingTip = pendingOrders.reduce((sum, o) => sum + toNum(o.tip ?? 0), 0);
        return {
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
          pendingPaymentMethod: pendingMethod,
          pendingTip,
          isCurrentShift: new Date(s.openedAt) >= shiftStart,
        };
      }),
    });
  } catch (err) {
    console.error("Failed to fetch sessions:", err);
    return NextResponse.json({ sessions: [], currentShift });
  }
}
