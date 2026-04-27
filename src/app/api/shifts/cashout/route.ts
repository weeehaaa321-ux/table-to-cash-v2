import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";
import { getCurrentShift } from "@/lib/shifts";
import { nowInRestaurantTz } from "@/lib/restaurant-config";
import { toNum } from "@/lib/money";

// Convert a Cairo-local date string (YYYY-MM-DD) to UTC Date
function cairoDateToUTC(dateStr: string, hour: number = 0): Date {
  const now = new Date();
  const cairoNow = nowInRestaurantTz(now);
  const offset = now.getTime() - cairoNow.getTime();
  const [y, m, d] = dateStr.split("-").map(Number);
  const local = new Date(y, m - 1, d, hour, 0, 0, 0);
  return new Date(local.getTime() + offset);
}

// Get today's date in Cairo as YYYY-MM-DD
function todayCairo(): string {
  const cairoNow = nowInRestaurantTz();
  return `${cairoNow.getFullYear()}-${String(cairoNow.getMonth() + 1).padStart(2, "0")}-${String(cairoNow.getDate()).padStart(2, "0")}`;
}

// GET: Cash summary per waiter
// Params:
//   restaurantId (required)
//   from: YYYY-MM-DD (default: today)
//   to: YYYY-MM-DD (default: same as from)
//   shift: 1|2|3 (optional, filter to specific shift)
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const restaurantId = url.searchParams.get("restaurantId") || "";
  const fromDate = url.searchParams.get("from") || todayCairo();
  const toDate = url.searchParams.get("to") || fromDate;
  const shiftFilter = url.searchParams.get("shift") ? parseInt(url.searchParams.get("shift")!) : null;

  if (!restaurantId) {
    return NextResponse.json({ error: "restaurantId required" }, { status: 400 });
  }

  try {
    const realId = await useCases.schedule.resolveRestaurantId(restaurantId);
    if (!realId) return NextResponse.json({ days: [], totals: { cash: 0, card: 0, revenue: 0 } });

    const rangeStart = cairoDateToUTC(fromDate, 0);
    const rangeEnd = cairoDateToUTC(toDate, 24);

    const waiters = await useCases.schedule.listWaitersAndCashiers(realId);
    const sessions = await useCases.schedule.listSessionsWithPaidOrdersInRange({
      restaurantId: realId,
      rangeStart,
      rangeEnd,
    });

    // Determine shift based on Cairo-local hour of a timestamp
    function getShiftForTime(ts: Date): number {
      const cairoTime = nowInRestaurantTz(ts);
      const h = cairoTime.getHours();
      if (h < 8) return 1;
      if (h < 16) return 2;
      return 3;
    }

    function getDateForTime(ts: Date): string {
      const cairoTime = nowInRestaurantTz(ts);
      return `${cairoTime.getFullYear()}-${String(cairoTime.getMonth() + 1).padStart(2, "0")}-${String(cairoTime.getDate()).padStart(2, "0")}`;
    }

    // Group by day → shift → waiter
    type WaiterEntry = {
      id: string; name: string; shift: number;
      cashTotal: number; cashOrders: number;
      cardTotal: number; cardOrders: number;
      totalRevenue: number; totalOrders: number;
      tables: number[];
    };
    type ShiftEntry = { shift: number; waiters: Map<string, WaiterEntry>; cash: number; card: number; revenue: number };
    type DayEntry = { date: string; shifts: Map<number, ShiftEntry>; cash: number; card: number; revenue: number };

    const dayMap = new Map<string, DayEntry>();

    for (const session of sessions) {
      const wid = session.waiter?.id;
      const wname = session.waiter?.name || "Unknown";
      if (!wid) continue;

      for (const order of session.orders) {
        // Use paidAt for day/shift attribution — orders paid after midnight belong to the new day
        const revenueTime = order.paidAt || order.createdAt;
        const orderShift = getShiftForTime(revenueTime);
        if (shiftFilter && orderShift !== shiftFilter) continue;

        const dateKey = getDateForTime(revenueTime);

        if (!dayMap.has(dateKey)) {
          dayMap.set(dateKey, { date: dateKey, shifts: new Map(), cash: 0, card: 0, revenue: 0 });
        }
        const day = dayMap.get(dateKey)!;

        if (!day.shifts.has(orderShift)) {
          day.shifts.set(orderShift, { shift: orderShift, waiters: new Map(), cash: 0, card: 0, revenue: 0 });
        }
        const shiftEntry = day.shifts.get(orderShift)!;

        if (!shiftEntry.waiters.has(wid)) {
          const wStaff = waiters.find((w) => w.id === wid);
          shiftEntry.waiters.set(wid, {
            id: wid, name: wname, shift: wStaff?.shift || 0,
            cashTotal: 0, cashOrders: 0, cardTotal: 0, cardOrders: 0,
            totalRevenue: 0, totalOrders: 0, tables: [],
          });
        }
        const waiterEntry = shiftEntry.waiters.get(wid)!;

        if (session.table?.number != null && !waiterEntry.tables.includes(session.table.number)) {
          waiterEntry.tables.push(session.table.number);
        }

        const isCash = order.paymentMethod === "CASH";
        const amount = toNum(order.total);

        waiterEntry.totalRevenue += amount;
        waiterEntry.totalOrders++;
        if (isCash) { waiterEntry.cashTotal += amount; waiterEntry.cashOrders++; }
        else { waiterEntry.cardTotal += amount; waiterEntry.cardOrders++; }

        if (isCash) { shiftEntry.cash += amount; day.cash += amount; }
        else { shiftEntry.card += amount; day.card += amount; }
        shiftEntry.revenue += amount;
        day.revenue += amount;
      }
    }

    // Serialize
    const days = Array.from(dayMap.values())
      .sort((a, b) => b.date.localeCompare(a.date)) // newest first
      .map((day) => ({
        date: day.date,
        cash: Math.round(day.cash),
        card: Math.round(day.card),
        revenue: Math.round(day.revenue),
        shifts: Array.from(day.shifts.values())
          .sort((a, b) => a.shift - b.shift)
          .map((s) => ({
            shift: s.shift,
            label: `Shift ${s.shift}`,
            cash: Math.round(s.cash),
            card: Math.round(s.card),
            revenue: Math.round(s.revenue),
            waiters: Array.from(s.waiters.values())
              .sort((a, b) => b.cashTotal - a.cashTotal)
              .map((w) => ({
                id: w.id,
                name: w.name,
                cashInPocket: Math.round(w.cashTotal),
                cashOrders: w.cashOrders,
                cardTotal: Math.round(w.cardTotal),
                cardOrders: w.cardOrders,
                totalRevenue: Math.round(w.totalRevenue),
                totalOrders: w.totalOrders,
                tablesServed: w.tables,
              })),
          })),
      }));

    const totalCash = days.reduce((s, d) => s + d.cash, 0);
    const totalCard = days.reduce((s, d) => s + d.card, 0);
    const totalRevenue = days.reduce((s, d) => s + d.revenue, 0);

    return NextResponse.json({
      from: fromDate,
      to: toDate,
      currentShift: getCurrentShift(),
      days,
      totals: { cash: totalCash, card: totalCard, revenue: totalRevenue },
    });
  } catch (err) {
    console.error("Cashout fetch failed:", err);
    return NextResponse.json({ error: "Failed to fetch cashout" }, { status: 500 });
  }
}
