"use client";

// ═══════════════════════════════════════════════════════
// DECISION RULES
// ═══════════════════════════════════════════════════════
// Each rule is a self-contained unit with:
// - trigger condition
// - priority
// - affected systems
// - action list
// - expected outcome
// - evaluation metric
// - cooldown (prevents re-firing too soon)
//
// Rules are evaluated every tick, sorted by priority,
// and checked for conflicts before execution.
// ═══════════════════════════════════════════════════════

import type { DecisionPriority } from "./state";
import type { OrchestratorAction } from "./actions";
import {
  boostItems,
  hideItems,
  activatePromotion,
  alertOwner,
  alertStaff,
} from "./actions";
import { useMenu } from "@/store/menu";
import type { ItemPerformance } from "../intelligence";

// ─── Rule Definition ─────────────────────────────────

export type DecisionRule = {
  id: string;
  name: string;
  priority: DecisionPriority;
  affectedSystems: ("customer" | "kitchen" | "staff" | "owner")[];
  expectedOutcome: string;
  evaluationMetric: string;
  cooldownMs: number;
  // Tags for conflict resolution — rules with overlapping tags conflict
  tags: string[];
  // Condition: returns a trigger description if rule should fire, or null
  evaluate: (ctx: RuleContext) => string | null;
  // Actions to dispatch if rule fires
  buildActions: (ctx: RuleContext, hiddenSet: Set<string>) => OrchestratorAction[];
};

export type RuleContext = {
  kitchenCapacityPct: number;
  occupancyPct: number;
  cartAbandonmentPct: number;
  avgWaitMin: number;
  activeOrderCount: number;
  trafficLevel: string;
  kitchenLoad: string;
  customerBehavior: string;
  itemPerformance: ItemPerformance[];
  mode: "aggressive" | "balanced" | "safe";
};

// ─── Threshold multipliers per mode ──────────────────

function threshold(base: number, mode: string): number {
  if (mode === "aggressive") return base * 0.8; // triggers earlier
  if (mode === "safe") return base * 1.3; // triggers later
  return base;
}

// ═══════════════════════════════════════════════════════
// RULE DEFINITIONS
// ═══════════════════════════════════════════════════════

export const DECISION_RULES: DecisionRule[] = [
  // ── CRITICAL: Kitchen Overload ─────────────────
  {
    id: "kitchen_overload",
    name: "Kitchen Overload Response",
    priority: "critical",
    affectedSystems: ["customer", "staff", "owner"],
    expectedOutcome: "Reduce kitchen pressure by shifting demand to fast items",
    evaluationMetric: "kitchen_capacity",
    cooldownMs: 120_000,
    tags: ["menu_ranking", "kitchen"],

    evaluate: (ctx) => {
      const t = threshold(75, ctx.mode);
      if (ctx.kitchenCapacityPct >= t) {
        return `Kitchen at ${ctx.kitchenCapacityPct}% capacity (threshold: ${Math.round(t)}%)`;
      }
      return null;
    },

    buildActions: (ctx, hiddenSet) => {
      const actions: OrchestratorAction[] = [];
      const slowItems = useMenu.getState().allItems.filter((i) => (i.prepTime || 0) >= 15);
      const fastHighMargin = useMenu.getState().allItems.filter((i) => (i.prepTime || 0) <= 5 && i.highMargin);

      // Hide slow items
      if (ctx.mode !== "safe") {
        actions.push(...hideItems(slowItems.map((i) => i.id), hiddenSet));
      }

      // Boost fast items
      actions.push(...boostItems(fastHighMargin.map((i) => i.id), "kitchen overload — push fast items"));

      // Alerts
      actions.push(alertStaff(`Kitchen at ${ctx.kitchenCapacityPct}% — expect delays on complex items`));
      actions.push(alertOwner(`Kitchen overloaded — auto-shifting menu to fast-prep items`));

      return actions;
    },
  },

  // ── CRITICAL: Extreme Wait Times ───────────────
  {
    id: "extreme_wait",
    name: "Extreme Wait Time Response",
    priority: "critical",
    affectedSystems: ["kitchen", "staff", "owner"],
    expectedOutcome: "Reduce incoming complexity, alert all stations",
    evaluationMetric: "avg_wait_time",
    cooldownMs: 180_000,
    tags: ["kitchen", "wait_time"],

    evaluate: (ctx) => {
      const t = threshold(20, ctx.mode);
      if (ctx.avgWaitMin >= t) {
        return `Average wait ${ctx.avgWaitMin}m (threshold: ${Math.round(t)}m)`;
      }
      return null;
    },

    buildActions: (ctx, hiddenSet) => {
      const slowItems = useMenu.getState().allItems.filter((i) => (i.prepTime || 0) >= 18);
      const actions: OrchestratorAction[] = [];

      actions.push(...hideItems(slowItems.map((i) => i.id), hiddenSet));
      actions.push(alertStaff(`Wait times critical at ${ctx.avgWaitMin}m — prioritize ready orders`));
      actions.push(alertOwner(`Wait times at ${ctx.avgWaitMin}m — system hiding slow-prep items`));

      return actions;
    },
  },

  // ── HIGH: High Traffic Optimization ────────────
  {
    id: "high_traffic",
    name: "High Traffic Optimization",
    priority: "high",
    affectedSystems: ["customer", "kitchen", "owner"],
    expectedOutcome: "Maximize throughput with fast high-margin items",
    evaluationMetric: "revenue_per_minute",
    cooldownMs: 180_000,
    tags: ["menu_ranking", "traffic"],

    evaluate: (ctx) => {
      const t = threshold(70, ctx.mode);
      if (ctx.occupancyPct >= t) {
        return `Occupancy ${ctx.occupancyPct}% — ${ctx.trafficLevel} traffic`;
      }
      return null;
    },

    buildActions: (ctx, hiddenSet) => {
      const fastHighMargin = useMenu.getState().allItems.filter((i) => (i.prepTime || 0) <= 8 && i.highMargin);
      const actions: OrchestratorAction[] = [];

      actions.push(...boostItems(fastHighMargin.map((i) => i.id), "high traffic — fast high-margin"));

      if (ctx.mode === "aggressive") {
        const slowLowMargin = useMenu.getState().allItems.filter((i) => (i.prepTime || 0) >= 18 && !i.highMargin);
        actions.push(...hideItems(slowLowMargin.map((i) => i.id), hiddenSet));
      }

      actions.push(alertOwner(`High traffic detected — promoting ${fastHighMargin.length} fast items`));

      return actions;
    },
  },

  // ── HIGH: Item Underperforming ─────────────────
  {
    id: "item_underperform",
    name: "Underperforming Item Response",
    priority: "high",
    affectedSystems: ["customer", "owner"],
    expectedOutcome: "Replace underperformer with better-converting alternative",
    evaluationMetric: "item_conversion_rate",
    cooldownMs: 300_000,
    tags: ["menu_ranking", "item_performance"],

    evaluate: (ctx) => {
      const leaking = ctx.itemPerformance.filter((p) => p.trend === "leaking" && p.views > 15);
      if (leaking.length > 0) {
        return `${leaking.length} item(s) leaking: ${leaking.map((l) => `"${l.name}" ${(l.conversionRate * 100).toFixed(0)}%`).join(", ")}`;
      }
      return null;
    },

    buildActions: (ctx, hiddenSet) => {
      const leaking = ctx.itemPerformance.filter((p) => p.trend === "leaking" && p.views > 15);
      const actions: OrchestratorAction[] = [];

      for (const item of leaking.slice(0, 2)) {
        // Hide underperformer
        if (ctx.mode !== "safe") {
          actions.push(...hideItems([item.itemId], hiddenSet));
        }

        // Find replacement in same category
        const menuItem = useMenu.getState().allItems.find((i) => i.id === item.itemId);
        const replacement = ctx.itemPerformance.find(
          (p) =>
            p.itemId !== item.itemId &&
            p.trend !== "leaking" &&
            p.trend !== "cold" &&
            useMenu.getState().allItems.find((i) => i.id === p.itemId)?.categoryId === menuItem?.categoryId
        );

        if (replacement) {
          actions.push(...boostItems([replacement.itemId], `replacing underperformer "${item.name}"`));
        }

        actions.push(alertOwner(`"${item.name}" underperforming — ${item.views} views, ${item.orders} orders`));
      }

      return actions;
    },
  },

  // ── MEDIUM: Hesitation / Abandonment Response ──
  {
    id: "hesitation_response",
    name: "Customer Hesitation Response",
    priority: "medium",
    affectedSystems: ["customer", "owner"],
    expectedOutcome: "Reduce cart abandonment, increase conversion",
    evaluationMetric: "cart_abandonment",
    cooldownMs: 180_000,
    tags: ["customer_behavior", "promotions"],

    evaluate: (ctx) => {
      const t = threshold(20, ctx.mode);
      if (ctx.cartAbandonmentPct >= t || ctx.customerBehavior === "abandoning") {
        return `Cart abandonment at ${ctx.cartAbandonmentPct.toFixed(0)}% — customers ${ctx.customerBehavior}`;
      }
      return null;
    },

    buildActions: (_ctx, _hiddenSet) => {
      const bestSellers = useMenu.getState().allItems.filter((i) => i.bestSeller);
      const actions: OrchestratorAction[] = [];

      actions.push(...boostItems(bestSellers.map((i) => i.id), "hesitation response"));
      actions.push(activatePromotion("Trending Now", "Popular", bestSellers.map((i) => i.id)));
      actions.push(alertOwner(`Customer hesitation detected — promoting best sellers`));

      return actions;
    },
  },

  // ── MEDIUM: Upsell Opportunity ─────────────────
  {
    id: "upsell_push",
    name: "Upsell Opportunity",
    priority: "medium",
    affectedSystems: ["customer"],
    expectedOutcome: "Increase average order value via high-margin suggestions",
    evaluationMetric: "avg_order_value",
    cooldownMs: 240_000,
    tags: ["promotions", "customer_behavior"],

    evaluate: (ctx) => {
      // Only when kitchen is not stressed and customers are buying
      if (ctx.kitchenLoad === "light" || ctx.kitchenLoad === "normal") {
        if (ctx.customerBehavior === "buying" || ctx.customerBehavior === "exploring") {
          return `Kitchen relaxed (${ctx.kitchenLoad}) — good time for upsells`;
        }
      }
      return null;
    },

    buildActions: (_ctx, _hiddenSet) => {
      const highMarginPremium = useMenu.getState().allItems.filter((i) => i.highMargin && i.price >= 100);
      const actions: OrchestratorAction[] = [];

      actions.push(...boostItems(highMarginPremium.map((i) => i.id), "upsell opportunity"));

      return actions;
    },
  },

  // ── LOW: Evening Drink Push ────────────────────
  {
    id: "evening_drinks",
    name: "Evening Drink Push",
    priority: "low",
    affectedSystems: ["customer"],
    expectedOutcome: "Increase drink revenue during sunset window",
    evaluationMetric: "drink_revenue",
    cooldownMs: 600_000,
    tags: ["promotions", "time_based"],

    evaluate: (_ctx) => {
      const hour = new Date().getHours();
      if (hour >= 17 && hour < 21) {
        return `Evening window (${hour}:00) — prime cocktail time`;
      }
      return null;
    },

    buildActions: (_ctx, _hiddenSet) => {
      const drinks = useMenu.getState().allItems.filter((i) => i.tags.includes("cocktail") || i.tags.includes("premium-drink"));
      const actions: OrchestratorAction[] = [];

      actions.push(...boostItems(drinks.map((i) => i.id), "evening drink push"));
      actions.push(activatePromotion("Sunset Hour", "Sunset Special", drinks.map((i) => i.id)));

      return actions;
    },
  },
];
