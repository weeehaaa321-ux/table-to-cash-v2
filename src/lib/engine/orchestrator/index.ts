"use client";

// ═══════════════════════════════════════════════════════
// ORCHESTRATOR — Central Coordination Engine
// ═══════════════════════════════════════════════════════
//
// Decision loop per tick:
//   1. Collect  — read perception + action stores
//   2. Assess   — compute global state
//   3. Evaluate — run all decision rules
//   4. Sort     — order by priority
//   5. Resolve  — detect + resolve conflicts
//   6. Execute  — dispatch actions to stores
//   7. Log      — record decisions + register feedback
//
// ═══════════════════════════════════════════════════════

import { usePerception } from "../perception";
import { analyzeItemPerformance } from "../intelligence";
import {
  useSystemState,
  PRIORITY_RANK,
  type TrafficLevel,
  type KitchenLoadLevel,
  type CustomerBehaviorLevel,
  type DecisionRecord,
  type ConflictLog,
  type PendingFeedback,
} from "./state";
import { DECISION_RULES, type RuleContext } from "./decisions";
import type { OrchestratorAction } from "./actions";

// Re-export store for consumers
export { useSystemState } from "./state";
export type { DecisionRecord, SystemMode, DecisionPriority } from "./state";

// ─── DECISION LOOP ───────────────────────────────────

export function orchestratorTick() {
  const perception = usePerception.getState();
  const sys = useSystemState.getState();
  const now = Date.now();

  const { kitchen, orders, tableStates, metrics } = perception;

  // ═══ STEP 1: COLLECT ═══════════════════════════

  const activeOrders = orders.filter((o) =>
    ["pending", "confirmed", "preparing"].includes(o.status)
  );
  const itemPerf = analyzeItemPerformance(perception.itemViews, orders);

  // ═══ STEP 2: ASSESS GLOBAL STATE ═══════════════

  const occupancyPct = metrics.occupancy;
  const kitchenCapacityPct = kitchen.capacity;
  const cartAbandonmentPct = metrics.cartAbandonment;
  const avgWaitMin = metrics.avgWaitTime;

  const trafficLevel: TrafficLevel =
    occupancyPct >= 85 ? "peak"
    : occupancyPct >= 60 ? "high"
    : occupancyPct >= 30 ? "normal"
    : "low";

  const kitchenLoad: KitchenLoadLevel =
    kitchenCapacityPct >= 90 ? "critical"
    : kitchenCapacityPct >= 65 ? "heavy"
    : kitchenCapacityPct >= 30 ? "normal"
    : "light";

  const recentOrders = orders.filter((o) => now - o.createdAt < 300_000);
  const idleBrowsing = tableStates.filter(
    (t) => t.status === "browsing" && now - t.lastActivity > 120_000
  ).length;

  const customerBehavior: CustomerBehaviorLevel =
    recentOrders.length > 5 ? "buying"
    : cartAbandonmentPct > 20 ? "abandoning"
    : idleBrowsing > 3 ? "hesitating"
    : "exploring";

  // ═══ STEP 3: EVALUATE ALL RULES ════════════════

  const ctx: RuleContext = {
    kitchenCapacityPct,
    occupancyPct,
    cartAbandonmentPct,
    avgWaitMin,
    activeOrderCount: activeOrders.length,
    trafficLevel,
    kitchenLoad,
    customerBehavior,
    itemPerformance: itemPerf,
    mode: sys.systemMode,
  };

  type FiredRule = {
    ruleId: string;
    trigger: string;
    priority: (typeof DECISION_RULES)[number]["priority"];
    tags: string[];
    actions: OrchestratorAction[];
    rule: (typeof DECISION_RULES)[number];
  };

  const firedRules: FiredRule[] = [];
  const hiddenSet = new Set<string>();

  for (const rule of DECISION_RULES) {
    // Skip disabled rules
    if (sys.disabledRules.has(rule.id)) continue;

    // Check cooldown — don't re-fire too soon
    const lastFired = sys.decisions
      .filter((d) => d.ruleId === rule.id && !d.reverted)
      .sort((a, b) => b.timestamp - a.timestamp)[0];

    if (lastFired && now - lastFired.timestamp < rule.cooldownMs) continue;

    // Evaluate trigger
    const trigger = rule.evaluate(ctx);
    if (!trigger) continue;

    // Build actions
    const actions = rule.buildActions(ctx, hiddenSet);

    firedRules.push({
      ruleId: rule.id,
      trigger,
      priority: rule.priority,
      tags: rule.tags,
      actions,
      rule,
    });
  }

  // ═══ STEP 4: SORT BY PRIORITY ══════════════════

  firedRules.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);

  // ═══ STEP 5: CONFLICT RESOLUTION ═══════════════

  const conflicts: ConflictLog[] = [];
  const accepted: FiredRule[] = [];
  const usedTags = new Set<string>();

  for (const fired of firedRules) {
    // Check for tag overlap with already-accepted higher-priority rules
    const conflicting = fired.tags.some((t) => usedTags.has(t));

    if (conflicting) {
      // Find which accepted rule conflicts
      const winner = accepted.find((a) => a.tags.some((t) => fired.tags.includes(t)));
      if (winner) {
        conflicts.push({
          winnerId: winner.ruleId,
          loserId: fired.ruleId,
          reason: `"${winner.rule.name}" (${winner.priority}) overrides "${fired.rule.name}" (${fired.priority}) — shared tag conflict`,
          timestamp: now,
        });
      }
      continue; // skip this rule
    }

    // Accept this rule
    accepted.push(fired);
    fired.tags.forEach((t) => usedTags.add(t));
  }

  // ═══ STEP 6: EXECUTE ACTIONS ═══════════════════

  const pushedSet = new Set<string>();
  const newDecisions: DecisionRecord[] = [];

  for (const fired of accepted) {
    // Execute all actions
    for (const action of fired.actions) {
      action.execute();
    }

    // Build decision record
    newDecisions.push({
      id: `dec-${now}-${fired.ruleId}`,
      ruleId: fired.ruleId,
      trigger: fired.trigger,
      priority: fired.priority,
      affectedSystems: fired.rule.affectedSystems,
      actions: fired.actions.map((a) => ({
        description: a.description,
        targetSystem: a.targetSystem,
      })),
      expectedOutcome: fired.rule.expectedOutcome,
      evaluationMetric: fired.rule.evaluationMetric,
      timestamp: now,
      reverted: false,
      disabledByOwner: false,
    });
  }

  // ═══ STEP 7: FEEDBACK LOOP ═════════════════════

  const updatedDecisions = [...sys.decisions];

  const remainingFeedback = sys.pendingFeedback.filter((fb) => {
    // Evaluate after 60 seconds
    if (now - fb.measuredAt < 60_000) return true;

    const currentMetrics = usePerception.getState().metrics;
    let currentValue = 0;

    if (fb.metric === "kitchen_capacity") currentValue = currentMetrics.avgWaitTime;
    else if (fb.metric === "revenue_per_minute") currentValue = currentMetrics.revenueToday;
    else if (fb.metric === "cart_abandonment") currentValue = currentMetrics.cartAbandonment;
    else if (fb.metric === "avg_wait_time") currentValue = currentMetrics.avgWaitTime;
    else if (fb.metric === "item_conversion_rate") currentValue = currentMetrics.ordersToday;
    else if (fb.metric === "avg_order_value") currentValue = currentMetrics.avgOrderValue;
    else currentValue = currentMetrics.revenueToday;

    const delta = currentValue - fb.baselineValue;
    const isPositiveMetric = !["cart_abandonment", "avg_wait_time", "kitchen_capacity"].includes(fb.metric);
    const improved = isPositiveMetric ? delta > 0 : delta < 0;

    // Attach impact to the decision
    const dec = updatedDecisions.find((d) => d.id === fb.decisionId);
    if (dec) {
      dec.impact = {
        metric: fb.metric,
        before: fb.baselineValue,
        after: currentValue,
        delta,
        improved,
      };

      // In safe mode, auto-revert if impact is negative
      if (!improved && sys.systemMode === "safe") {
        dec.reverted = true;
      }
    }

    return false; // evaluated, remove from pending
  });

  // Register feedback for new decisions
  const newFeedback: PendingFeedback[] = newDecisions.map((d) => {
    let baselineValue = 0;
    if (d.evaluationMetric === "kitchen_capacity") baselineValue = kitchenCapacityPct;
    else if (d.evaluationMetric === "revenue_per_minute") baselineValue = metrics.revenueToday;
    else if (d.evaluationMetric === "cart_abandonment") baselineValue = cartAbandonmentPct;
    else if (d.evaluationMetric === "avg_wait_time") baselineValue = avgWaitMin;
    else if (d.evaluationMetric === "item_conversion_rate") baselineValue = metrics.ordersToday;
    else if (d.evaluationMetric === "avg_order_value") baselineValue = metrics.avgOrderValue;
    else baselineValue = metrics.revenueToday;

    return {
      decisionId: d.id,
      metric: d.evaluationMetric,
      baselineValue,
      measuredAt: now,
    };
  });

  // ═══ PUSH STATE ════════════════════════════════

  const allDecisions = [...updatedDecisions, ...newDecisions].slice(-50);

  useSystemState.setState({
    trafficLevel,
    kitchenLoad,
    customerBehavior,
    kitchenCapacityPct,
    occupancyPct,
    cartAbandonmentPct,
    avgWaitMin,
    activeOrderCount: activeOrders.length,
    decisions: allDecisions,
    conflicts: [...sys.conflicts, ...conflicts].slice(-20),
    pendingFeedback: [...remainingFeedback, ...newFeedback],
    hiddenItemIds: hiddenSet,
    pushedItemIds: pushedSet,
  });
}
