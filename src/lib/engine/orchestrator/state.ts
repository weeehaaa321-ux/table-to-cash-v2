"use client";

// ═══════════════════════════════════════════════════════
// GLOBAL SYSTEM STATE
// ═══════════════════════════════════════════════════════
// Single source of truth for cross-system state.
// Continuously updated each tick from perception data.
// Read-only for all systems except the orchestrator.
// ═══════════════════════════════════════════════════════

import { create } from "zustand";

// ─── Types ───────────────────────────────────────────

export type TrafficLevel = "low" | "normal" | "high" | "peak";
export type KitchenLoadLevel = "light" | "normal" | "heavy" | "critical";
export type CustomerBehaviorLevel = "exploring" | "buying" | "hesitating" | "abandoning";
export type SystemMode = "aggressive" | "balanced" | "safe";

export type DecisionPriority = "critical" | "high" | "medium" | "low";

export const PRIORITY_RANK: Record<DecisionPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

// ─── Decision Record ─────────────────────────────────

export type DecisionRecord = {
  id: string;
  ruleId: string;
  trigger: string;
  priority: DecisionPriority;
  affectedSystems: ("customer" | "kitchen" | "staff" | "owner")[];
  actions: { description: string; targetSystem: string }[];
  expectedOutcome: string;
  evaluationMetric: string;
  timestamp: number;
  // Feedback
  impact?: {
    metric: string;
    before: number;
    after: number;
    delta: number;
    improved: boolean;
  };
  reverted: boolean;
  overriddenBy?: string; // id of decision that overrode this one
  disabledByOwner: boolean;
};

// ─── Pending Feedback ────────────────────────────────

export type PendingFeedback = {
  decisionId: string;
  metric: string;
  baselineValue: number;
  measuredAt: number;
};

// ─── Conflict Log ────────────────────────────────────

export type ConflictLog = {
  winnerId: string;
  loserId: string;
  reason: string;
  timestamp: number;
};

// ─── Store ───────────────────────────────────────────

export type GlobalStateStore = {
  // Assessed each tick
  trafficLevel: TrafficLevel;
  kitchenLoad: KitchenLoadLevel;
  customerBehavior: CustomerBehaviorLevel;
  kitchenCapacityPct: number;
  occupancyPct: number;
  cartAbandonmentPct: number;
  avgWaitMin: number;
  activeOrderCount: number;

  // Owner controls
  systemMode: SystemMode;
  disabledRules: Set<string>; // rule IDs the owner has turned off

  // Decision log
  decisions: DecisionRecord[];
  conflicts: ConflictLog[];
  pendingFeedback: PendingFeedback[];

  // Orchestrator outputs
  hiddenItemIds: Set<string>;
  pushedItemIds: Set<string>;

  // Actions
  setSystemMode: (mode: SystemMode) => void;
  toggleRule: (ruleId: string) => void;
  revertDecision: (decisionId: string) => void;
};

export const useSystemState = create<GlobalStateStore>((set, get) => ({
  trafficLevel: "normal",
  kitchenLoad: "normal",
  customerBehavior: "exploring",
  kitchenCapacityPct: 0,
  occupancyPct: 0,
  cartAbandonmentPct: 0,
  avgWaitMin: 0,
  activeOrderCount: 0,

  systemMode: "balanced",
  disabledRules: new Set(),

  decisions: [],
  conflicts: [],
  pendingFeedback: [],

  hiddenItemIds: new Set(),
  pushedItemIds: new Set(),

  setSystemMode: (systemMode) => set({ systemMode }),

  toggleRule: (ruleId) => {
    const disabled = new Set(get().disabledRules);
    if (disabled.has(ruleId)) {
      disabled.delete(ruleId);
    } else {
      disabled.add(ruleId);
    }
    set({ disabledRules: disabled });
  },

  revertDecision: (decisionId) => {
    set({
      decisions: get().decisions.map((d) =>
        d.id === decisionId ? { ...d, reverted: true } : d
      ),
      // Clear orchestrator outputs — will be recalculated next tick
      hiddenItemIds: new Set(),
      pushedItemIds: new Set(),
    });
  },
}));
