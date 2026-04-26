"use client";

// ═══════════════════════════════════════════════
// ACTION LAYER — The restaurant's hands
// Takes intelligence signals and ACTS:
// reorders menu, triggers promos, pushes upsells,
// adapts UI in real time
// ═══════════════════════════════════════════════

import { create } from "zustand";
import type { RankedItem } from "./intelligence";

export type ActivePromotion = {
  id: string;
  type: "sunset" | "happy_hour" | "flash" | "combo" | "welcome";
  title: string;
  subtitle: string;
  badge: string;
  itemIds: string[];
  discountPercent?: number;
  expiresAt?: number;
  active: boolean;
};

export type BoostedItem = {
  itemId: string;
  reason: string;
  boostScore: number;
  expiresAt: number;
};

export type SmartInterruption = {
  id: string;
  type: "upsell" | "combo" | "scarcity" | "social_proof" | "chef_pick" | "idle_nudge";
  itemId: string;
  message: string;
  subMessage?: string;
  priority: number; // higher = show first
  shownAt?: number;
  dismissed?: boolean;
};

export type ActionState = {
  // Dynamic menu order (recalculated by intelligence)
  menuRanking: RankedItem[];

  // Active promotions the system has triggered
  activePromotions: ActivePromotion[];

  // Individually boosted items (from owner one-tap or auto)
  boostedItems: BoostedItem[];

  // Queue of smart interruptions for customer UI
  interruptionQueue: SmartInterruption[];

  // Social proof counters (simulated/real)
  orderCounts: Map<string, number>; // itemId → orders today
  scarcityItems: Set<string>;       // items marked as scarce

  // Actions
  setMenuRanking: (ranking: RankedItem[]) => void;
  activatePromo: (promo: ActivePromotion) => void;
  deactivatePromo: (promoId: string) => void;
  boostItem: (itemId: string, reason: string) => void;
  unboostItem: (itemId: string) => void;
  queueInterruption: (interruption: SmartInterruption) => void;
  dismissInterruption: (id: string) => void;
  popInterruption: () => SmartInterruption | null;
  updateOrderCounts: (counts: Map<string, number>) => void;
  setScarcityItems: (items: Set<string>) => void;
};

export const useAction = create<ActionState>((set, get) => ({
  menuRanking: [],
  activePromotions: [],
  boostedItems: [],
  interruptionQueue: [],
  orderCounts: new Map(),
  scarcityItems: new Set(),

  setMenuRanking: (menuRanking) => set({ menuRanking }),

  activatePromo: (promo) => {
    const existing = get().activePromotions;
    const filtered = existing.filter((p) => p.id !== promo.id);
    set({ activePromotions: [...filtered, { ...promo, active: true }] });
  },

  deactivatePromo: (promoId) => {
    set({
      activePromotions: get().activePromotions.map((p) =>
        p.id === promoId ? { ...p, active: false } : p
      ),
    });
  },

  boostItem: (itemId, reason) => {
    const existing = get().boostedItems.filter((b) => b.itemId !== itemId);
    set({
      boostedItems: [
        ...existing,
        {
          itemId,
          reason,
          boostScore: 30,
          expiresAt: Date.now() + 30 * 60 * 1000, // 30 min
        },
      ],
    });
  },

  unboostItem: (itemId) => {
    set({
      boostedItems: get().boostedItems.filter((b) => b.itemId !== itemId),
    });
  },

  queueInterruption: (interruption) => {
    const queue = get().interruptionQueue;
    // Don't double-queue
    if (queue.some((q) => q.id === interruption.id)) return;
    set({
      interruptionQueue: [...queue, interruption].sort(
        (a, b) => b.priority - a.priority
      ),
    });
  },

  dismissInterruption: (id) => {
    set({
      interruptionQueue: get().interruptionQueue.map((q) =>
        q.id === id ? { ...q, dismissed: true } : q
      ),
    });
  },

  popInterruption: () => {
    const queue = get().interruptionQueue;
    const next = queue.find((q) => !q.dismissed && !q.shownAt);
    if (!next) return null;
    set({
      interruptionQueue: queue.map((q) =>
        q.id === next.id ? { ...q, shownAt: Date.now() } : q
      ),
    });
    return next;
  },

  updateOrderCounts: (counts) => set({ orderCounts: counts }),
  setScarcityItems: (items) => set({ scarcityItems: items }),
}));

// ─── Contextual Upsell Logic ──────────────────

type CartContext = {
  itemIds: string[];
  total: number;
  itemCount: number;
};

type TimeContext = {
  hour: number;
  isWeekend: boolean;
};

export function generateSmartInterruptions(
  cart: CartContext,
  time: TimeContext,
  userIdleMs: number,
  allItems: { id: string; name: string; tags: string[]; price: number; highMargin: boolean; bestSeller: boolean }[]
): SmartInterruption[] {
  const interruptions: SmartInterruption[] = [];
  const inCart = new Set(cart.itemIds);

  // 1. Idle nudge (>15s no interaction)
  if (userIdleMs > 15000) {
    const chef = allItems.find((i) => i.highMargin && !inCart.has(i.id));
    if (chef) {
      interruptions.push({
        id: `idle-${chef.id}`,
        type: "chef_pick",
        itemId: chef.id,
        message: "Chef's pick for you",
        subMessage: "Our kitchen recommends this right now",
        priority: 3,
      });
    }
  }

  // 2. Meal completion (has main, no drink)
  const hasDrink = cart.itemIds.some((id) => {
    const item = allItems.find((i) => i.id === id);
    return item?.tags.some((t) => ["drink", "cocktail", "wine", "beer", "juice", "coffee"].includes(t));
  });
  const hasMain = cart.itemIds.some((id) => {
    const item = allItems.find((i) => i.id === id);
    return item?.tags.includes("main");
  });

  if (hasMain && !hasDrink) {
    const drink = allItems.find(
      (i) => !inCart.has(i.id) && i.tags.some((t) => ["drink", "cocktail"].includes(t)) && i.highMargin
    );
    if (drink) {
      interruptions.push({
        id: `complete-drink-${drink.id}`,
        type: "combo",
        itemId: drink.id,
        message: "Complete your meal",
        subMessage: "A perfect pairing awaits",
        priority: 8,
      });
    }
  }

  // 3. No dessert + has main → suggest dessert
  const hasDessert = cart.itemIds.some((id) => {
    const item = allItems.find((i) => i.id === id);
    return item?.tags.includes("dessert");
  });
  if (hasMain && !hasDessert && cart.itemCount >= 2) {
    const dessert = allItems.find(
      (i) => !inCart.has(i.id) && i.tags.includes("dessert") && i.bestSeller
    );
    if (dessert) {
      interruptions.push({
        id: `dessert-${dessert.id}`,
        type: "upsell",
        itemId: dessert.id,
        message: "Save room for dessert?",
        subMessage: "Our most loved sweet finish",
        priority: 5,
      });
    }
  }

  // 4. Evening cocktail push
  if (time.hour >= 17 && time.hour < 21 && !hasDrink) {
    const cocktail = allItems.find(
      (i) => !inCart.has(i.id) && i.tags.includes("cocktail")
    );
    if (cocktail) {
      interruptions.push({
        id: `sunset-${cocktail.id}`,
        type: "social_proof",
        itemId: cocktail.id,
        message: "Sunset hour favourite",
        subMessage: "Most ordered right now",
        priority: 6,
      });
    }
  }

  return interruptions.sort((a, b) => b.priority - a.priority);
}
