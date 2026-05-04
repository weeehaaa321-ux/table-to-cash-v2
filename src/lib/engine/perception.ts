"use client";

import { create } from "zustand";

// ═══════════════════════════════════════════════
// PERCEPTION LAYER — The restaurant's nervous system
// Tracks every signal: views, dwell, scroll, taps,
// abandonment, wait times, table states, guest types
// ═══════════════════════════════════════════════

export type ItemView = {
  itemId: string;
  timestamp: number;
  dwellMs: number;
  scrollDepth: number;
  addedToCart: boolean;
  source: "browse" | "upsell" | "search" | "promo";
};

export type TableState = {
  id: number;
  status: "empty" | "seated" | "browsing" | "ordered" | "eating" | "waiting_bill" | "paying";
  guestCount: number;
  sessionStart: number;
  currentOrderValue: number;
  engagementScore: number;
  itemsViewed: number;
  itemsOrdered: number;
  lastActivity: number;
  orderId?: string;
  alerts: TableAlert[];       // active warnings
};

export type TableAlert = {
  type: "idle_long" | "order_stuck" | "waiting_too_long" | "high_value";
  message: string;
  since: number;
};

export type KitchenState = {
  activeOrders: number;
  avgPrepTime: number;
  bottleneckItems: string[];
  capacity: number;
  stuckOrders: string[];      // order IDs that are stuck
};

export type LiveOrder = {
  id: string;
  orderNumber: number;
  tableNumber: number | null;
  sessionId?: string;
  paymentMethod?: string;
  items: { id: string; menuItemId?: string; name: string; quantity: number; price: number; wasUpsell: boolean; notes?: string | null; cancelled?: boolean; cancelReason?: string | null; comped?: boolean; compReason?: string | null }[];
  total: number;
  status: "pending" | "confirmed" | "preparing" | "ready" | "served" | "paid" | "cancelled";
  createdAt: number;
  prepStartedAt?: number;
  readyAt?: number;
  servedAt?: number;
  isDelayed: boolean;
  delayMinutes?: number;
  notes?: string;
  source?: "real";
  station?: "KITCHEN" | "BAR" | "ACTIVITY";
  groupId?: string | null;
  orderType?: string;
  vipGuestName?: string | null;
  deliveryStatus?: string | null;
  guestNumber?: number | null;
  guestName?: string | null;
};

export type RevenueSegment = {
  walkin: { revenue: number; orders: number; avgValue: number };
  room: { revenue: number; orders: number; avgValue: number };
};

export type PerceptionState = {
  itemViews: Map<string, ItemView[]>;
  tableStates: TableState[];
  kitchen: KitchenState;
  bar: KitchenState;
  orders: LiveOrder[];
  revenueSegment: RevenueSegment;
  // Staff IDs currently clocked in. Refreshed by /api/live-snapshot
  // alongside orders/sessions so the dashboard's "On Shift Now" bulbs
  // don't need a second dedicated poll. `openStaffIdsLoaded` flips true
  // the first time the snapshot reply lands — until then, consumers
  // can't tell "no one is clocked in" from "we haven't asked yet" and
  // shouldn't act on the empty set (e.g. force-show the clock-in gate).
  openStaffIds: ReadonlySet<string>;
  openStaffIdsLoaded: boolean;

  metrics: {
    revenueToday: number;
    ordersToday: number;
    tipsToday: number;
    avgOrderValue: number;
    ordersPerMinute: number;
    upsellConversions: number;
    totalUpsellAttempts: number;
    upsellRevenue: number;
    cartAbandonment: number;
    avgWaitTime: number;
    // Floor-handoff metric: avg(servedAt - readyAt). Decouples "guest
    // is waiting because the kitchen is slow" (avgWaitTime / kitchen
    // avgPrepTime) from "guest is waiting because food is sitting on
    // the pass" (avgPickupTime).
    avgPickupTime: number;
    peakHourRevenue: number;
    occupancy: number;          // % tables occupied
    guestsNow: number;
  };

  // Actions
  trackView: (view: ItemView) => void;
  updateTable: (tableId: number, update: Partial<TableState>) => void;
  updateKitchen: (update: Partial<KitchenState>) => void;
  addOrder: (order: LiveOrder) => void;
  updateOrder: (orderId: string, update: Partial<LiveOrder>) => void;
  setTables: (tables: TableState[]) => void;
  setOrders: (orders: LiveOrder[]) => void;
  updateMetrics: (metrics: Partial<PerceptionState["metrics"]>) => void;
  setRevenueSegment: (seg: RevenueSegment) => void;
};

export const usePerception = create<PerceptionState>((set, get) => ({
  itemViews: new Map(),
  tableStates: [],
  kitchen: {
    activeOrders: 0,
    avgPrepTime: 0,
    bottleneckItems: [],
    capacity: 0,
    stuckOrders: [],
  },
  bar: {
    activeOrders: 0,
    avgPrepTime: 0,
    bottleneckItems: [],
    capacity: 0,
    stuckOrders: [],
  },
  orders: [],
  revenueSegment: {
    walkin: { revenue: 0, orders: 0, avgValue: 0 },
    room: { revenue: 0, orders: 0, avgValue: 0 },
  },
  openStaffIds: new Set<string>(),
  openStaffIdsLoaded: false,
  metrics: {
    revenueToday: 0,
    ordersToday: 0,
    tipsToday: 0,
    avgOrderValue: 0,
    ordersPerMinute: 0,
    upsellConversions: 0,
    totalUpsellAttempts: 0,
    upsellRevenue: 0,
    cartAbandonment: 0,
    avgWaitTime: 0,
    avgPickupTime: 0,
    peakHourRevenue: 0,
    occupancy: 0,
    guestsNow: 0,
  },

  trackView: (view) => {
    const views = new Map(get().itemViews);
    const existing = views.get(view.itemId) || [];
    views.set(view.itemId, [...existing, view]);
    set({ itemViews: views });
  },

  updateTable: (tableId, update) => {
    set({
      tableStates: get().tableStates.map((t) =>
        t.id === tableId ? { ...t, ...update, lastActivity: Date.now() } : t
      ),
    });
  },

  updateKitchen: (update) => {
    set({ kitchen: { ...get().kitchen, ...update } });
  },

  addOrder: (order) => {
    set({ orders: [...get().orders, order] });
  },

  updateOrder: (orderId, update) => {
    set({
      orders: get().orders.map((o) =>
        o.id === orderId ? { ...o, ...update } : o
      ),
    });
  },

  setTables: (tables) => set({ tableStates: tables }),
  setOrders: (orders) => set({ orders }),
  setRevenueSegment: (revenueSegment) => set({ revenueSegment }),

  updateMetrics: (metrics) => {
    set({ metrics: { ...get().metrics, ...metrics } });
  },
}));
