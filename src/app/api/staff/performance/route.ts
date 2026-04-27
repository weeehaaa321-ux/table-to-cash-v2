import { NextRequest, NextResponse } from "next/server";
import { legacyDb as db } from "@/infrastructure/composition";
import { nowInRestaurantTz } from "@/lib/restaurant-config";
import { toNum } from "@/lib/money";

async function resolveRestaurantId(id: string): Promise<string | null> {
  if (!id) return null;
  if (id.startsWith("c") && id.length > 10) return id;
  const restaurant = await db.restaurant.findUnique({
    where: { slug: id },
    select: { id: true },
  });
  return restaurant?.id || null;
}

// GET: Waiter performance stats — ranked by real service metrics
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const restaurantId = url.searchParams.get("restaurantId") || "";
  const period = url.searchParams.get("period") || "day";

  if (!restaurantId) {
    return NextResponse.json({ error: "restaurantId required" }, { status: 400 });
  }

  try {
    const realId = await resolveRestaurantId(restaurantId);
    if (!realId) return NextResponse.json({ waiters: [] });

    const now = new Date();
    let since: Date;
    if (period === "week") {
      since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === "month") {
      since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else {
      const cairoNow = nowInRestaurantTz(now);
      since = new Date(cairoNow.getFullYear(), cairoNow.getMonth(), cairoNow.getDate());
      const offset = now.getTime() - cairoNow.getTime();
      since = new Date(since.getTime() + offset);
    }

    const waiters = await db.staff.findMany({
      where: { restaurantId: realId, role: "WAITER" },
      select: { id: true, name: true, active: true, shift: true },
      orderBy: { name: "asc" },
    });

    const sessions = await db.tableSession.findMany({
      where: {
        restaurantId: realId,
        waiterId: { not: null },
        openedAt: { gte: since },
      },
      include: {
        orders: {
          select: {
            id: true,
            total: true,
            status: true,
            paymentMethod: true,
            items: { select: { quantity: true } },
            createdAt: true,
            updatedAt: true,
            paidAt: true,
          },
        },
        waiter: { select: { id: true } },
      },
    });

    type WaiterStats = {
      sessionsHandled: number;
      ordersHandled: number;
      totalRevenue: number;
      cashRevenue: number;
      cardRevenue: number;
      itemsServed: number;
      paidOrders: number;
      // Time-based metrics (in minutes)
      totalServingTimeMs: number;     // sum of (paidAt - createdAt) for paid orders
      servedOrderCount: number;       // orders with paidAt (for avg calculation)
      totalTurnaroundMs: number;      // sum of (closedAt - openedAt) for closed sessions
      closedSessionCount: number;     // sessions with closedAt
      totalSessionMinutes: number;
      // Derived
      hoursWorked: number;
    };

    const stats = new Map<string, WaiterStats>();
    for (const w of waiters) {
      stats.set(w.id, {
        sessionsHandled: 0, ordersHandled: 0, totalRevenue: 0,
        cashRevenue: 0, cardRevenue: 0, itemsServed: 0, paidOrders: 0,
        totalServingTimeMs: 0, servedOrderCount: 0,
        totalTurnaroundMs: 0, closedSessionCount: 0,
        totalSessionMinutes: 0, hoursWorked: 0,
      });
    }

    for (const session of sessions) {
      const wid = session.waiter?.id;
      if (!wid || !stats.has(wid)) continue;

      const s = stats.get(wid)!;
      s.sessionsHandled++;

      const durationMs = session.closedAt
        ? session.closedAt.getTime() - session.openedAt.getTime()
        : now.getTime() - session.openedAt.getTime();
      s.totalSessionMinutes += durationMs / 60000;

      // Table turnaround (only closed sessions)
      if (session.closedAt) {
        s.totalTurnaroundMs += session.closedAt.getTime() - session.openedAt.getTime();
        s.closedSessionCount++;
      }

      for (const order of session.orders) {
        s.ordersHandled++;
        const orderTotal = toNum(order.total);
        s.totalRevenue += orderTotal;
        s.itemsServed += order.items.reduce((sum, i) => sum + i.quantity, 0);

        if (order.status === "PAID") {
          s.paidOrders++;
          if (order.paymentMethod === "CASH") s.cashRevenue += orderTotal;
          else s.cardRevenue += orderTotal;
        }

        // Serving time: from order creation to paid/completed
        if (order.paidAt) {
          const servingMs = order.paidAt.getTime() - order.createdAt.getTime();
          if (servingMs > 0 && servingMs < 4 * 60 * 60 * 1000) { // sanity: < 4 hours
            s.totalServingTimeMs += servingMs;
            s.servedOrderCount++;
          }
        }
      }
    }

    // Compute hours worked (time span from first session open to now or last session close)
    for (const w of waiters) {
      const waiterSessions = sessions.filter((s) => s.waiter?.id === w.id);
      if (waiterSessions.length === 0) continue;
      const firstOpen = Math.min(...waiterSessions.map((s) => s.openedAt.getTime()));
      const lastClose = Math.max(...waiterSessions.map((s) => (s.closedAt || now).getTime()));
      const s = stats.get(w.id)!;
      s.hoursWorked = (lastClose - firstOpen) / (60 * 60 * 1000);
    }

    const result = waiters.map((w) => {
      const s = stats.get(w.id)!;
      const avgServingMin = s.servedOrderCount > 0 ? Math.round(s.totalServingTimeMs / s.servedOrderCount / 60000) : 0;
      const avgTurnaroundMin = s.closedSessionCount > 0 ? Math.round(s.totalTurnaroundMs / s.closedSessionCount / 60000) : 0;
      const tablesPerHour = s.hoursWorked > 0.5 ? Math.round((s.closedSessionCount / s.hoursWorked) * 10) / 10 : 0;

      // Performance score (lower serving time + higher throughput = better)
      // Score: tables/hr * 20 + (30 - avgServingMin capped) + orders * 2
      const servingScore = Math.max(0, 30 - Math.min(avgServingMin, 30));
      const throughputScore = tablesPerHour * 20;
      const volumeScore = s.ordersHandled * 2;
      const performanceScore = Math.round(servingScore + throughputScore + volumeScore);

      return {
        id: w.id,
        name: w.name,
        active: w.active,
        shift: w.shift,
        sessionsHandled: s.sessionsHandled,
        ordersHandled: s.ordersHandled,
        totalRevenue: Math.round(s.totalRevenue),
        cashRevenue: Math.round(s.cashRevenue),
        cardRevenue: Math.round(s.cardRevenue),
        itemsServed: s.itemsServed,
        paidOrders: s.paidOrders,
        avgOrderValue: s.ordersHandled > 0 ? Math.round(s.totalRevenue / s.ordersHandled) : 0,
        avgSessionMinutes: s.sessionsHandled > 0 ? Math.round(s.totalSessionMinutes / s.sessionsHandled) : 0,
        // New performance metrics
        avgServingMinutes: avgServingMin,
        avgTurnaroundMinutes: avgTurnaroundMin,
        tablesPerHour,
        closedSessions: s.closedSessionCount,
        performanceScore,
      };
    })
    .filter((w) => w.ordersHandled > 0 || w.sessionsHandled > 0)
    .sort((a, b) => b.performanceScore - a.performanceScore);

    return NextResponse.json(
      { waiters: result, period, since: since.toISOString() },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      },
    );
  } catch (err) {
    console.error("Performance fetch failed:", err);
    return NextResponse.json({ error: "Failed to fetch performance" }, { status: 500 });
  }
}
