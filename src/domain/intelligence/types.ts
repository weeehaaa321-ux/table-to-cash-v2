// ─────────────────────────────────────────────────────────────────
// Intelligence layer types — pure data, no I/O.
//
// Source: src/lib/engine/{perception,intelligence,action,orchestrator}.
// In source these are "use client" React-coupled. The pure analysis
// pieces are extracted here; the React glue lives in the presentation
// hook src/presentation/hooks/useIntelligence.ts.
// ─────────────────────────────────────────────────────────────────

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

export type ItemTrend = "hot" | "rising" | "steady" | "cold" | "leaking";
// "leaking" = high views, low conversion

export type ItemPerformance = {
  itemId: string;
  name: string;
  views: number;
  orders: number;
  conversionRate: number; // views → orders (0–1)
  avgDwellTimeMs: number;
  revenueMinor: number; // minor units, currency-implicit
  trend: ItemTrend;
  heatScore: number; // 0–100 composite attention
};

// View record produced by perception layer (in presentation): records
// each time a guest opened/dwelt on a menu item without ordering.
export type ItemView = {
  dwellMs: number;
  addedToCart: boolean;
};

// Reduced order shape needed by analyzers (avoids domain coupling to
// the full Order entity in this pure layer).
export type LiveOrder = {
  items: ReadonlyArray<{ id: string; quantity: number; priceMinor: number }>;
};
