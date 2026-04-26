import type { ItemPerformance, ItemTrend, ItemView, LiveOrder } from "./types";

/**
 * Compute per-item performance from view records and live orders.
 *
 * Mirrors src/lib/engine/intelligence.ts in source repo. Pure: no
 * timing, no I/O, no React. Inputs are flat data; outputs are a
 * deterministic ranking. Tests can pin exact ItemPerformance shapes.
 *
 * `nameLookup` is a function so the caller (presentation layer) can
 * supply menu item names without this domain function depending on
 * the MenuItem entity.
 */
export function analyzeItemPerformance(
  itemViews: ReadonlyMap<string, readonly ItemView[]>,
  orders: readonly LiveOrder[],
  nameLookup: (itemId: string) => string,
): ItemPerformance[] {
  // Tally orders + revenue by itemId.
  const orderCounts = new Map<string, { count: number; revenueMinor: number }>();
  for (const order of orders) {
    for (const it of order.items) {
      const existing = orderCounts.get(it.id) ?? { count: 0, revenueMinor: 0 };
      orderCounts.set(it.id, {
        count: existing.count + it.quantity,
        revenueMinor: existing.revenueMinor + it.quantity * it.priceMinor,
      });
    }
  }

  // Compute per-item perf for every item that has either views or orders.
  const itemIds = new Set<string>([...itemViews.keys(), ...orderCounts.keys()]);
  const results: ItemPerformance[] = [];

  for (const itemId of itemIds) {
    const views = itemViews.get(itemId) ?? [];
    const ordered = orderCounts.get(itemId) ?? { count: 0, revenueMinor: 0 };
    const viewCount = views.length;
    const conversionRate = viewCount === 0 ? 0 : ordered.count / viewCount;
    const avgDwellMs =
      viewCount === 0
        ? 0
        : views.reduce((sum, v) => sum + v.dwellMs, 0) / viewCount;

    results.push({
      itemId,
      name: nameLookup(itemId),
      views: viewCount,
      orders: ordered.count,
      conversionRate,
      avgDwellTimeMs: avgDwellMs,
      revenueMinor: ordered.revenueMinor,
      trend: classifyTrend({ viewCount, orders: ordered.count, conversionRate }),
      heatScore: heatScore({ viewCount, orders: ordered.count, conversionRate, avgDwellMs }),
    });
  }

  // Sort descending by heat score so callers can take the top N easily.
  results.sort((a, b) => b.heatScore - a.heatScore);
  return results;
}

// ─── Pure helpers (exported for testability) ──────────────────────

export function classifyTrend(input: {
  viewCount: number;
  orders: number;
  conversionRate: number;
}): ItemTrend {
  const { viewCount, orders, conversionRate } = input;
  // No views, no orders → cold.
  if (viewCount === 0 && orders === 0) return "cold";
  // High views, low conversion → leaking (the actionable insight).
  if (viewCount >= 30 && conversionRate < 0.1) return "leaking";
  // High orders, moderate views → hot.
  if (orders >= 20 && conversionRate >= 0.3) return "hot";
  // Decent orders, decent conversion → rising.
  if (orders >= 5 && conversionRate >= 0.2) return "rising";
  // Has views but few orders → steady (or just slow).
  return "steady";
}

export function heatScore(input: {
  viewCount: number;
  orders: number;
  conversionRate: number;
  avgDwellMs: number;
}): number {
  const { viewCount, orders, conversionRate, avgDwellMs } = input;
  // 0–100 composite. Weights mirror source repo defaults.
  const viewScore = Math.min(viewCount / 50, 1) * 30;
  const orderScore = Math.min(orders / 30, 1) * 40;
  const convScore = Math.min(conversionRate / 0.5, 1) * 20;
  const dwellScore = Math.min(avgDwellMs / 5000, 1) * 10;
  return Math.round(viewScore + orderScore + convScore + dwellScore);
}
