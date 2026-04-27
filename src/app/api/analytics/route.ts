import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";
import { nowInRestaurantTz } from "@/lib/restaurant-config";
import { toNum } from "@/lib/money";

function startOfCairoDay(d: Date): Date {
  const cairo = nowInRestaurantTz(d);
  const start = new Date(cairo.getFullYear(), cairo.getMonth(), cairo.getDate());
  const offset = d.getTime() - cairo.getTime();
  return new Date(start.getTime() + offset);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const restaurantId = url.searchParams.get("restaurantId") || "";
  const period = (url.searchParams.get("period") || "day") as "day" | "week" | "month";

  if (!restaurantId) {
    return NextResponse.json({ error: "restaurantId required" }, { status: 400 });
  }

  try {
    const realId = await useCases.analytics.resolveRestaurantId(restaurantId);
    if (!realId) {
      return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
    }

    const now = new Date();
    let since: Date;
    let bucketCount: number;
    let bucketMs: number;
    if (period === "week") {
      since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      bucketCount = 7;
      bucketMs = 24 * 60 * 60 * 1000;
    } else if (period === "month") {
      since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      bucketCount = 30;
      bucketMs = 24 * 60 * 60 * 1000;
    } else {
      since = startOfCairoDay(now);
      bucketCount = 24;
      bucketMs = 60 * 60 * 1000;
    }

    const { orders, sessions, staff } = await useCases.analytics.listForDashboard(realId, since);
    const orderIds = orders.map((o) => o.id);
    const [cancelledItems, compedItems] = await useCases.analytics.cancelledAndCompedForOrders(orderIds, since);

    // ── Summary ──
    const paidOrders = orders.filter((o) => o.status === "PAID");
    const revenue = paidOrders.reduce((s, o) => s + toNum(o.total), 0);
    const guests = sessions.reduce((s, ss) => s + (ss.guestCount || 0), 0);
    const avgCheck = paidOrders.length > 0 ? revenue / paidOrders.length : 0;

    // ── Time-series buckets (revenue + orders) ──
    const buckets = Array.from({ length: bucketCount }, (_, i) => ({
      t: since.getTime() + i * bucketMs,
      revenue: 0,
      orders: 0,
    }));
    for (const o of paidOrders) {
      const idx = Math.floor((o.createdAt.getTime() - since.getTime()) / bucketMs);
      if (idx >= 0 && idx < bucketCount) {
        buckets[idx].revenue += toNum(o.total);
        buckets[idx].orders++;
      }
    }

    // ── Hour heatmap (all periods collapsed to hour-of-day) ──
    const hourHeatmap = Array.from({ length: 24 }, (_, h) => ({ hour: h, revenue: 0, orders: 0 }));
    for (const o of paidOrders) {
      const cairo = nowInRestaurantTz(o.createdAt);
      const h = cairo.getHours();
      hourHeatmap[h].revenue += toNum(o.total);
      hourHeatmap[h].orders++;
    }

    // ── Top items ──
    const itemMap = new Map<string, { id: string; name: string; qty: number; revenue: number }>();
    for (const o of paidOrders) {
      for (const it of o.items) {
        if (!it.menuItem) continue;
        const key = it.menuItem.id;
        const entry = itemMap.get(key) || { id: key, name: it.menuItem.name, qty: 0, revenue: 0 };
        entry.qty += it.quantity;
        entry.revenue += toNum(it.price) * it.quantity;
        itemMap.set(key, entry);
      }
    }
    const topItems = Array.from(itemMap.values())
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);

    // ── Payment mix ──
    const paymentMix: Record<string, { count: number; revenue: number }> = {};
    for (const o of paidOrders) {
      const method = o.paymentMethod || "UNKNOWN";
      if (!paymentMix[method]) paymentMix[method] = { count: 0, revenue: 0 };
      paymentMix[method].count++;
      paymentMix[method].revenue += toNum(o.total);
    }

    // ── Staff quality KPIs (quality over volume) ──
    // Per staff member (waiter role):
    //   avgServeFromReadyMin: mean of (servedAt - readyAt) over orders they owned
    //   tablesHandled:        count of sessions owned
    type StaffAgg = {
      id: string;
      name: string;
      role: string;
      active: boolean;
      serveTimes: number[];   // ms
      tablesHandled: number;
      ordersHandled: number;
      ratings: number;
    };
    const staffAgg = new Map<string, StaffAgg>();
    for (const s of staff) {
      staffAgg.set(s.id, {
        id: s.id,
        name: s.name,
        role: s.role,
        active: s.active,
        serveTimes: [],
        tablesHandled: 0,
        ordersHandled: 0,
        ratings: 0,
      });
    }

    for (const o of orders) {
      const wid = o.session?.waiterId;
      if (!wid) continue;
      const agg = staffAgg.get(wid);
      if (!agg) continue;
      agg.ordersHandled++;
      if (o.readyAt && o.servedAt) {
        const ms = o.servedAt.getTime() - o.readyAt.getTime();
        if (ms > 0 && ms < 2 * 60 * 60 * 1000) agg.serveTimes.push(ms);
      }
    }

    for (const ss of sessions) {
      if (!ss.waiterId) continue;
      const agg = staffAgg.get(ss.waiterId);
      if (!agg) continue;
      agg.tablesHandled++;
    }

    const staffQuality = Array.from(staffAgg.values())
      .filter((s) => s.role === "WAITER" && (s.ordersHandled > 0 || s.tablesHandled > 0))
      .map((s) => {
        const avg = (arr: number[]) =>
          arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : null;
        const avgServe = avg(s.serveTimes);
        return {
          id: s.id,
          name: s.name,
          active: s.active,
          ordersHandled: s.ordersHandled,
          tablesHandled: s.tablesHandled,
          avgServeFromReadyMin: avgServe != null ? Math.round(avgServe / 60000) : null,
          serveSamples: s.serveTimes.length,
        };
      });

    // Rank: best = lowest avgServe (null last), break ties by more orders handled
    staffQuality.sort((a, b) => {
      const aS = a.avgServeFromReadyMin ?? 999;
      const bS = b.avgServeFromReadyMin ?? 999;
      if (aS !== bS) return aS - bS;
      return b.ordersHandled - a.ordersHandled;
    });

    // ── Kitchen quality — avg prep time (confirmed→ready proxy using createdAt→readyAt) ──
    const prepTimes: number[] = [];
    for (const o of orders) {
      if (o.readyAt) {
        const ms = o.readyAt.getTime() - o.createdAt.getTime();
        if (ms > 0 && ms < 90 * 60 * 1000) prepTimes.push(ms);
      }
    }
    const kitchen = {
      avgPrepMin:
        prepTimes.length > 0
          ? Math.round(prepTimes.reduce((a, b) => a + b, 0) / prepTimes.length / 60000)
          : null,
      samples: prepTimes.length,
    };

    // ── Cancellations ──
    const cancelledCount = cancelledItems.length;
    const cancelledRevenue = cancelledItems.reduce((s, it) => s + toNum(it.price) * it.quantity, 0);
    const reasonCounts: Record<string, number> = {};
    for (const it of cancelledItems) {
      const r = it.cancelReason || "No reason";
      reasonCounts[r] = (reasonCounts[r] || 0) + 1;
    }
    const topReasons = Object.entries(reasonCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count }));
    const topCancelledItems: Record<string, { name: string; qty: number; revenue: number }> = {};
    for (const it of cancelledItems) {
      const name = it.menuItem?.name ?? "Deleted item";
      if (!topCancelledItems[name]) topCancelledItems[name] = { name, qty: 0, revenue: 0 };
      topCancelledItems[name].qty += it.quantity;
      topCancelledItems[name].revenue += toNum(it.price) * it.quantity;
    }
    const cancellations = {
      items: cancelledCount,
      revenue: Math.round(cancelledRevenue),
      topReasons,
      topItems: Object.values(topCancelledItems).sort((a, b) => b.revenue - a.revenue).slice(0, 5),
    };

    // ── Comps (free items given away — kitchen cost incurred, no revenue) ──
    const compedCount = compedItems.length;
    const compedValue = compedItems.reduce((s, it) => s + toNum(it.price) * it.quantity, 0);
    const compReasonCounts: Record<string, number> = {};
    for (const it of compedItems) {
      const r = it.compReason || "No reason";
      compReasonCounts[r] = (compReasonCounts[r] || 0) + 1;
    }
    const topCompReasons = Object.entries(compReasonCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([reason, count]) => ({ reason, count }));
    const topCompedItemsMap: Record<string, { name: string; qty: number; value: number }> = {};
    for (const it of compedItems) {
      const name = it.menuItem?.name ?? "Deleted item";
      if (!topCompedItemsMap[name]) topCompedItemsMap[name] = { name, qty: 0, value: 0 };
      topCompedItemsMap[name].qty += it.quantity;
      topCompedItemsMap[name].value += toNum(it.price) * it.quantity;
    }
    const comps = {
      items: compedCount,
      // "value" rather than "revenue" — this is what you GAVE AWAY,
      // never what you collected.
      value: Math.round(compedValue),
      topReasons: topCompReasons,
      topItems: Object.values(topCompedItemsMap).sort((a, b) => b.value - a.value).slice(0, 5),
    };

    // ── Orders per hour ──
    const hoursElapsed = Math.max(1, (now.getTime() - since.getTime()) / 3600000);
    const ordersPerHour = paidOrders.length / hoursElapsed;

    return NextResponse.json(
      {
        period,
        since: since.toISOString(),
        summary: {
          revenue: Math.round(revenue),
          orders: paidOrders.length,
          sessions: sessions.length,
          guests,
          avgCheck: Math.round(avgCheck),
          ordersPerHour: Math.round(ordersPerHour * 10) / 10,
        },
        timeseries: buckets.map((b) => ({
          t: b.t,
          revenue: Math.round(b.revenue),
          orders: b.orders,
        })),
        hourHeatmap,
        topItems,
        paymentMix,
        staffQuality,
        kitchen,
        cancellations,
        comps,
      },
      {
        headers: {
          // Heavy aggregation endpoint — 30s cache materially cuts DB
          // load while keeping the dashboard's perceived freshness.
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      },
    );
  } catch (err) {
    console.error("Analytics fetch failed:", err);
    return NextResponse.json({ error: "Failed to fetch analytics" }, { status: 500 });
  }
}
