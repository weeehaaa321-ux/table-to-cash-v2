"use client";

// ═══════════════════════════════════════════════════════
// STANDARDIZED ACTION SYSTEM
// ═══════════════════════════════════════════════════════
// Every orchestrator action is a typed, dispatchable unit.
// Actions know their target system, expected effect, and
// how to execute against the Zustand stores.
// ═══════════════════════════════════════════════════════

import { useAction } from "../action";
import { useMenu } from "@/store/menu";

// ─── Action Definition ───────────────────────────────

export type ActionType = "ui_rank" | "ui_promo" | "system_boost" | "system_hide" | "alert";

export type OrchestratorAction = {
  type: ActionType;
  targetSystem: "customer" | "kitchen" | "staff" | "owner";
  description: string;
  expectedEffect: string;
  execute: () => void;
};

// ─── Action Factories ────────────────────────────────

export function boostItems(
  itemIds: string[],
  reason: string
): OrchestratorAction[] {
  return itemIds.map((id) => {
    const name = useMenu.getState().allItems.find((i) => i.id === id)?.name || id;
    return {
      type: "system_boost" as const,
      targetSystem: "customer" as const,
      description: `Boost "${name}" in menu ranking`,
      expectedEffect: "Higher visibility → more orders",
      execute: () => useAction.getState().boostItem(id, `Orchestrator: ${reason}`),
    };
  });
}

export function hideItems(
  itemIds: string[],
  hiddenSet: Set<string>
): OrchestratorAction[] {
  return itemIds.map((id) => {
    const name = useMenu.getState().allItems.find((i) => i.id === id)?.name || id;
    return {
      type: "system_hide" as const,
      targetSystem: "customer" as const,
      description: `Deprioritize "${name}" in menu`,
      expectedEffect: "Lower visibility → reduced kitchen load",
      execute: () => { hiddenSet.add(id); },
    };
  });
}

export function activatePromotion(
  title: string,
  badge: string,
  itemIds: string[]
): OrchestratorAction {
  return {
    type: "ui_promo",
    targetSystem: "customer",
    description: `Activate "${title}" promotion`,
    expectedEffect: "Increased conversion on target items",
    execute: () => {
      useAction.getState().activatePromo({
        id: `orch-promo-${Date.now()}`,
        type: "flash",
        title,
        subtitle: "System-triggered promotion",
        badge,
        itemIds,
        active: true,
      });
    },
  };
}

export function alertOwner(message: string): OrchestratorAction {
  return {
    type: "alert",
    targetSystem: "owner",
    description: message,
    expectedEffect: "Owner awareness and possible manual action",
    execute: () => {
      // Owner sees this via the decision feed — no separate dispatch needed
    },
  };
}

export function alertStaff(message: string): OrchestratorAction {
  return {
    type: "alert",
    targetSystem: "staff",
    description: message,
    expectedEffect: "Staff adjusts behavior or prioritization",
    execute: () => {
      // Staff sees updates via shared perception store
    },
  };
}
