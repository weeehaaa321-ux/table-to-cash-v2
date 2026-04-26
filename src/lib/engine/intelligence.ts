"use client";

// ═══════════════════════════════════════════════
// INTELLIGENCE LAYER — The restaurant's brain
// Interprets perception data → produces insights
// and actionable decisions in real-time
// ═══════════════════════════════════════════════

import type { PerceptionState, TableState, LiveOrder } from "./perception";
import { useMenu } from "@/store/menu";

// ─── Insight Types ────────────────────────────

export type InsightSeverity = "critical" | "warning" | "opportunity" | "info";

export type Insight = {
  id: string;
  type: string;
  severity: InsightSeverity;
  title: string;
  description: string;
  action?: InsightAction;
  metric?: { value: number; unit: string; trend: "up" | "down" | "flat" };
  timestamp: number;
};

export type InsightAction = {
  label: string;
  type: "boost_item" | "activate_promo" | "push_upsell" | "alert_kitchen" | "discount";
  payload: Record<string, string>;
};

// ─── Item Performance ─────────────────────────

export type ItemPerformance = {
  itemId: string;
  name: string;
  views: number;
  orders: number;
  conversionRate: number; // views → orders
  avgDwellTime: number;
  revenue: number;
  trend: "hot" | "rising" | "steady" | "cold" | "leaking";
  // "leaking" = high views, low conversion
  heatScore: number; // 0-100 composite attention score
};

// ─── Analysis Functions ───────────────────────

export function analyzeItemPerformance(
  itemViews: Map<string, { dwellMs: number; addedToCart: boolean }[]>,
  orders: LiveOrder[]
): ItemPerformance[] {
  const orderCounts = new Map<string, { count: number; revenue: number }>();

  for (const order of orders) {
    for (const item of order.items) {
      const existing = orderCounts.get(item.id) || { count: 0, revenue: 0 };
      orderCounts.set(item.id, {
        count: existing.count + item.quantity,
        revenue: existing.revenue + item.price * item.quantity,
      });
    }
  }

  return useMenu.getState().allItems.map((item) => {
    const views = itemViews.get(item.id) || [];
    const viewCount = views.length;
    const orderData = orderCounts.get(item.id) || { count: 0, revenue: 0 };
    const conversionRate = viewCount > 0 ? orderData.count / viewCount : 0;
    const avgDwellTime =
      views.length > 0
        ? views.reduce((s, v) => s + v.dwellMs, 0) / views.length
        : 0;

    // Heat score: weighted combo of views, dwell, orders
    const viewScore = Math.min(viewCount / 20, 1) * 30;
    const dwellScore = Math.min(avgDwellTime / 5000, 1) * 25;
    const orderScore = Math.min(orderData.count / 10, 1) * 30;
    const marginScore = item.highMargin ? 15 : 0;
    const heatScore = Math.round(viewScore + dwellScore + orderScore + marginScore);

    let trend: ItemPerformance["trend"] = "steady";
    if (viewCount > 10 && conversionRate < 0.05) trend = "leaking";
    else if (orderData.count > 8) trend = "hot";
    else if (conversionRate > 0.3) trend = "rising";
    else if (viewCount < 3) trend = "cold";

    return {
      itemId: item.id,
      name: item.name,
      views: viewCount,
      orders: orderData.count,
      conversionRate,
      avgDwellTime,
      revenue: orderData.revenue,
      trend,
      heatScore,
    };
  }).sort((a, b) => b.heatScore - a.heatScore);
}

// ─── Insight Generation ───────────────────────

export function generateInsights(perception: PerceptionState): Insight[] {
  const insights: Insight[] = [];
  const now = Date.now();

  // 1. Revenue leak detection
  const perf = analyzeItemPerformance(perception.itemViews, perception.orders);
  const leaking = perf.filter((p) => p.trend === "leaking");

  for (const item of leaking.slice(0, 3)) {
    insights.push({
      id: `leak-${item.itemId}`,
      type: "revenue_leak",
      severity: "critical",
      title: `"${item.name}" is leaking revenue`,
      description: `${item.views} views but only ${item.orders} orders (${(item.conversionRate * 100).toFixed(1)}% conversion). Consider: better photo, lower price, or position as upsell combo.`,
      action: {
        label: "Boost This Item",
        type: "boost_item",
        payload: { itemId: item.itemId },
      },
      metric: {
        value: item.conversionRate * 100,
        unit: "% conversion",
        trend: "down",
      },
      timestamp: now,
    });
  }

  // 2. Kitchen overload detection
  if (perception.kitchen.capacity > 80) {
    insights.push({
      id: "kitchen-overload",
      type: "kitchen_alert",
      severity: "warning",
      title: "Kitchen at capacity",
      description: `Kitchen load is at ${perception.kitchen.capacity}%. Consider slowing incoming orders or highlighting quick-prep items.`,
      action: {
        label: "Push Quick Items",
        type: "alert_kitchen",
        payload: {},
      },
      metric: {
        value: perception.kitchen.capacity,
        unit: "% capacity",
        trend: "up",
      },
      timestamp: now,
    });
  }

  // 3. Idle tables opportunity
  const idleTables = perception.tableStates.filter(
    (t) =>
      t.status === "seated" &&
      now - t.lastActivity > 120000 && // 2 min idle
      t.itemsOrdered === 0
  );

  if (idleTables.length > 0) {
    insights.push({
      id: "idle-tables",
      type: "engagement_drop",
      severity: "warning",
      title: `${idleTables.length} tables browsing without ordering`,
      description: `Tables ${idleTables.map((t) => t.id).join(", ")} are seated but haven't ordered. Push a welcome deal or highlight best sellers.`,
      action: {
        label: "Push Welcome Deal",
        type: "activate_promo",
        payload: { tables: idleTables.map((t) => String(t.id)).join(",") },
      },
      timestamp: now,
    });
  }

  // 4. High-demand trend detection
  const hot = perf.filter((p) => p.trend === "hot");
  if (hot.length > 0) {
    insights.push({
      id: "hot-items",
      type: "demand_trend",
      severity: "opportunity",
      title: `${hot[0].name} is trending`,
      description: `${hot[0].orders} orders and counting. Consider raising price or creating a premium combo.`,
      metric: {
        value: hot[0].orders,
        unit: "orders",
        trend: "up",
      },
      timestamp: now,
    });
  }

  // 5. Upsell performance
  const { upsellConversions, totalUpsellAttempts } = perception.metrics;
  const upsellRate =
    totalUpsellAttempts > 0 ? (upsellConversions / totalUpsellAttempts) * 100 : 0;

  if (upsellRate < 15 && totalUpsellAttempts > 5) {
    insights.push({
      id: "upsell-low",
      type: "upsell_performance",
      severity: "warning",
      title: "Upsell conversion is low",
      description: `Only ${upsellRate.toFixed(0)}% of upsell suggestions are accepted. Try pairing different items or adjusting timing.`,
      metric: { value: upsellRate, unit: "%", trend: "down" },
      timestamp: now,
    });
  } else if (upsellRate > 30) {
    insights.push({
      id: "upsell-high",
      type: "upsell_performance",
      severity: "opportunity",
      title: "Upsells are converting well",
      description: `${upsellRate.toFixed(0)}% conversion — your pairings are working. Consider more aggressive combos.`,
      metric: { value: upsellRate, unit: "%", trend: "up" },
      timestamp: now,
    });
  }

  // 6. Time-based opportunity
  const hour = new Date().getHours();
  if (hour >= 16 && hour < 18) {
    insights.push({
      id: "golden-hour",
      type: "time_trigger",
      severity: "opportunity",
      title: "Golden hour approaching",
      description: "Sunset window is prime cocktail time. Activate sunset specials to boost drink revenue.",
      action: {
        label: "Activate Sunset Mode",
        type: "activate_promo",
        payload: { promo: "sunset" },
      },
      timestamp: now,
    });
  }

  // 7. Cart abandonment spike
  if (perception.metrics.cartAbandonment > 25) {
    insights.push({
      id: "cart-abandon",
      type: "conversion_issue",
      severity: "critical",
      title: "Cart abandonment is high",
      description: `${perception.metrics.cartAbandonment.toFixed(0)}% of carts are abandoned. Common causes: price shock at checkout, too many steps, or slow load.`,
      metric: {
        value: perception.metrics.cartAbandonment,
        unit: "% abandoned",
        trend: "up",
      },
      timestamp: now,
    });
  }

  // 8. Wait time alert
  if (perception.metrics.avgWaitTime > 20) {
    insights.push({
      id: "wait-time",
      type: "service_alert",
      severity: "warning",
      title: "Wait times are climbing",
      description: `Average wait is ${perception.metrics.avgWaitTime.toFixed(0)} min. Customers start losing patience after 15 min.`,
      action: {
        label: "Alert Kitchen",
        type: "alert_kitchen",
        payload: {},
      },
      metric: {
        value: perception.metrics.avgWaitTime,
        unit: "min avg",
        trend: "up",
      },
      timestamp: now,
    });
  }

  return insights.sort((a, b) => {
    const severityOrder = { critical: 0, warning: 1, opportunity: 2, info: 3 };
    return severityOrder[a.severity] - severityOrder[b.severity];
  });
}

// ─── Dynamic Menu Ranking ─────────────────────

export type RankedItem = {
  itemId: string;
  score: number;
  reasons: string[];
};

export function rankMenuItems(
  perception: PerceptionState,
  hour: number,
  boostedItemIds?: Set<string>,
  hiddenItemIds?: Set<string>
): RankedItem[] {
  const perf = analyzeItemPerformance(perception.itemViews, perception.orders);

  return useMenu.getState().allItems.map((item) => {
    let score = 50; // base
    const reasons: string[] = [];
    const p = perf.find((x) => x.itemId === item.id);

    // Boosted by owner or action layer
    if (boostedItemIds?.has(item.id)) {
      score += 25;
      reasons.push("Boosted by owner");
    }

    // High margin boost
    if (item.highMargin) {
      score += 20;
      reasons.push("High margin");
    }

    // Best seller boost
    if (item.bestSeller) {
      score += 15;
      reasons.push("Best seller");
    }

    // Hot trend boost
    if (p?.trend === "hot") {
      score += 25;
      reasons.push("Trending now");
    }

    // Time-of-day relevance
    if (hour >= 17 && hour < 21 && item.tags.includes("premium-drink")) {
      score += 20;
      reasons.push("Evening drinks boost");
    }
    if (hour >= 7 && hour < 11 && item.tags.includes("breakfast")) {
      score += 20;
      reasons.push("Breakfast time");
    }
    if (hour >= 14 && hour < 17 && item.tags.includes("dessert")) {
      score += 10;
      reasons.push("Afternoon sweet");
    }

    // Kitchen capacity penalty
    if (
      perception.kitchen.capacity > 70 &&
      item.prepTime &&
      item.prepTime > 15
    ) {
      score -= 15;
      reasons.push("Kitchen busy — deprioritize slow prep");
    }

    // Leaking penalty (don't push broken items to top)
    if (p?.trend === "leaking") {
      score -= 10;
      reasons.push("Low conversion — needs fix");
    }

    // Orchestrator: hidden items get massive penalty
    if (hiddenItemIds?.has(item.id)) {
      score -= 40;
      reasons.push("Orchestrator: deprioritized");
    }

    return { itemId: item.id, score: Math.max(0, Math.min(100, score)), reasons };
  }).sort((a, b) => b.score - a.score);
}
