"use client";

// ═══════════════════════════════════════════════
// LIVE DATA HOOK
// Polls /api/live-snapshot, fills Zustand stores,
// computes metrics, runs orchestrator on real data
// ═══════════════════════════════════════════════

import { useEffect } from "react";
import { usePerception, type LiveOrder, type TableState } from "@/lib/engine/perception";
import { useAction } from "@/lib/engine/action";
import { rankMenuItems } from "@/lib/engine/intelligence";
import { orchestratorTick, useSystemState } from "@/lib/engine/orchestrator";
import { DEFAULT_KITCHEN_CONFIG, computeKitchenCapacity, normalizeKitchenConfig, type KitchenConfig } from "@/lib/kitchen-config";
import { startPoll } from "@/lib/polling";

// Dynamic table count — updated from API, defaults to 14
let TABLE_COUNT = 14;

// Per-restaurant kitchen config — refreshed from API alongside orders/tables.
let KITCHEN_CONFIG: KitchenConfig = DEFAULT_KITCHEN_CONFIG;
export function setKitchenConfig(cfg: unknown) {
  KITCHEN_CONFIG = normalizeKitchenConfig(cfg);
}

// ─── Convert API order to LiveOrder ──────────────

function toLiveOrder(raw: {
  id: string;
  orderNumber: number;
  tableNumber: number | null;
  items: { id?: string; menuItemId?: string; name: string; quantity: number; price: number; wasUpsell?: boolean; prepTime?: number; tags?: string[]; notes?: string | null; cancelled?: boolean; cancelReason?: string | null; comped?: boolean; compReason?: string | null }[];
  total: number;
  status: string;
  createdAt: string;
  updatedAt?: string;
  sessionId?: string;
  paymentMethod?: string;
  notes?: string | null;
  source?: string;
  station?: string;
  groupId?: string | null;
  readyAt?: string | null;
  servedAt?: string | null;
  orderType?: string;
  vipGuestName?: string | null;
  deliveryStatus?: string | null;
  guestNumber?: number | null;
}): LiveOrder {
  const createdAt = new Date(raw.createdAt).getTime();
  const statusMap: Record<string, LiveOrder["status"]> = {
    PENDING: "pending",
    CONFIRMED: "confirmed",
    PREPARING: "preparing",
    READY: "ready",
    SERVED: "served",
    PAID: "paid",
    CANCELLED: "cancelled",
  };
  const status = statusMap[raw.status] || (raw.status as LiveOrder["status"]);
  const readyAt = raw.readyAt ? new Date(raw.readyAt).getTime() : undefined;
  const servedAt = raw.servedAt ? new Date(raw.servedAt).getTime() : undefined;

  return {
    id: raw.id,
    orderNumber: raw.orderNumber,
    tableNumber: raw.tableNumber,
    items: raw.items.map((i) => ({
      id: i.id || i.menuItemId || "",
      name: i.name || "Item",
      quantity: i.quantity,
      price: i.price,
      wasUpsell: i.wasUpsell || false,
      notes: i.notes || undefined,
      cancelled: i.cancelled || false,
      cancelReason: i.cancelReason || undefined,
      comped: i.comped || false,
      compReason: i.compReason || undefined,
    })),
    total: raw.total,
    status,
    createdAt,
    isDelayed: false,
    prepStartedAt: status === "preparing" ? createdAt : undefined,
    readyAt,
    servedAt,
    sessionId: raw.sessionId || undefined,
    paymentMethod: raw.paymentMethod || undefined,
    notes: raw.notes || undefined,
    source: "real",
    station: (raw.station === "BAR" ? "BAR" : "KITCHEN") as "KITCHEN" | "BAR",
    groupId: raw.groupId ?? null,
    orderType: raw.orderType,
    vipGuestName: raw.vipGuestName ?? null,
    deliveryStatus: raw.deliveryStatus ?? null,
    guestNumber: raw.guestNumber ?? null,
  };
}

// ─── Compute metrics from orders + tables ────────

// Start-of-today in Cairo, as a UTC timestamp (ms). Used to filter
// the live orders list down to "today" for the dashboard KPIs —
// without this, right after midnight the dashboard keeps showing
// yesterday's totals because /api/live-snapshot returns the last 50
// orders regardless of day.
function startOfCairoDayMs(): number {
  const now = new Date();
  const cairoStr = now.toLocaleString("en-US", { timeZone: "Africa/Cairo" });
  const cairo = new Date(cairoStr);
  const startLocal = new Date(cairo.getFullYear(), cairo.getMonth(), cairo.getDate());
  const offset = now.getTime() - cairo.getTime();
  return startLocal.getTime() + offset;
}

function computeMetrics(orders: LiveOrder[], tables: TableState[]) {
  const now = Date.now();
  const todayStart = startOfCairoDayMs();
  const nonCancelled = orders.filter((o) => o.status !== "cancelled");
  const todayNonCancelled = nonCancelled.filter((o) => o.createdAt >= todayStart);
  const paidOrActiveToday = todayNonCancelled.filter((o) => o.status !== "pending");
  const revenueToday = paidOrActiveToday.reduce((s, o) => s + o.total, 0);
  const ordersToday = todayNonCancelled.length;
  const avgOrderValue = ordersToday > 0 ? Math.round(revenueToday / ordersToday) : 0;

  const activeOrders = orders.filter((o) =>
    ["pending", "confirmed", "preparing"].includes(o.status)
  );

  const preparingOrders = orders.filter((o) => o.status === "preparing");

  // Real kitchen prep time = average of (readyAt - createdAt) across every
  // order where the kitchen has actually marked READY. Falls back to 0
  // when no samples exist, and the UI renders "—" in that case. We do NOT
  // invent a number from "elapsed since prepStartedAt" because that inflates
  // the metric on a slow day (a single long-running order drags the average
  // into scary territory) and confuses owners on a clean slate.
  const completedPrep = orders.filter(
    (o) => typeof o.readyAt === "number" && typeof o.createdAt === "number"
  );
  const avgPrepTime =
    completedPrep.length > 0
      ? completedPrep.reduce((s, o) => s + (o.readyAt! - o.createdAt) / 60000, 0) / completedPrep.length
      : 0;

  // Real guest wait time = average of (servedAt - createdAt) — the full
  // door-to-plate experience from the guest's perspective.
  const completedServe = orders.filter(
    (o) => typeof o.servedAt === "number" && typeof o.createdAt === "number"
  );
  const avgWaitTime =
    completedServe.length > 0
      ? completedServe.reduce((s, o) => s + (o.servedAt! - o.createdAt) / 60000, 0) / completedServe.length
      : 0;

  const kitchenCapacity = computeKitchenCapacity(activeOrders.length, KITCHEN_CONFIG);

  // Bar: same computation, filtered to BAR-station orders.
  const barActive = activeOrders.filter((o) => o.station === "BAR");
  const barCompletedPrep = completedPrep.filter((o) => o.station === "BAR");
  const barAvgPrep =
    barCompletedPrep.length > 0
      ? barCompletedPrep.reduce((s, o) => s + (o.readyAt! - o.createdAt) / 60000, 0) / barCompletedPrep.length
      : 0;
  // Bar uses its own cap from the per-restaurant station caps config.
  const barCapacity = Math.min(
    100,
    Math.round((barActive.length / Math.max(1, KITCHEN_CONFIG.stationCaps.bar)) * 100)
  );
  const barStuck = barActive
    .filter((o) => {
      if (o.status === "preparing" && o.prepStartedAt) {
        return (now - o.prepStartedAt) / 60000 > 12;
      }
      return o.status === "pending" && (now - o.createdAt) / 60000 > 4;
    })
    .map((o) => o.id);

  const upsellItems = orders.flatMap((o) => o.items.filter((i) => i.wasUpsell));
  const upsellRevenue = upsellItems.reduce((s, i) => s + i.price * i.quantity, 0);

  const occupiedTables = tables.filter((t) => t.status !== "empty");
  const occupancy = Math.round((occupiedTables.length / TABLE_COUNT) * 100);
  const guestsNow = occupiedTables.reduce((s, t) => s + t.guestCount, 0);

  // Stuck orders
  const stuckOrders: string[] = [];
  for (const order of orders) {
    if (order.status === "preparing" && order.prepStartedAt) {
      const prepElapsed = (now - order.prepStartedAt) / 60000;
      if (prepElapsed > 18) {
        order.isDelayed = true;
        order.delayMinutes = Math.round(prepElapsed);
        stuckOrders.push(order.id);
      }
    }
    if (order.status === "pending" && (now - order.createdAt) / 60000 > 5) {
      stuckOrders.push(order.id);
    }
  }

  // Order counts per item
  const orderCounts = new Map<string, number>();
  for (const order of orders) {
    for (const item of order.items) {
      orderCounts.set(item.id, (orderCounts.get(item.id) || 0) + item.quantity);
    }
  }

  return {
    metrics: {
      revenueToday,
      ordersToday,
      tipsToday: 0, // server-provided, overlaid by caller
      avgOrderValue,
      ordersPerMinute: Math.max(0.1, ordersToday / Math.max(1, (now - (orders[0]?.createdAt || now)) / 60000)),
      upsellConversions: upsellItems.length,
      totalUpsellAttempts: Math.round(upsellItems.length * 2.5),
      upsellRevenue,
      cartAbandonment: 0,
      avgWaitTime: Math.round(avgWaitTime),
      peakHourRevenue: Math.max(revenueToday * 0.3, 2500),
      occupancy,
      guestsNow,
    },
    kitchen: {
      activeOrders: activeOrders.length,
      avgPrepTime: Math.round(avgPrepTime),
      bottleneckItems: preparingOrders.length > 3 ? [orders[0]?.items[0]?.id || ""] : [],
      capacity: kitchenCapacity,
      stuckOrders,
    },
    bar: {
      activeOrders: barActive.length,
      avgPrepTime: Math.round(barAvgPrep),
      bottleneckItems: [],
      capacity: barCapacity,
      stuckOrders: barStuck,
    },
    orderCounts,
  };
}

// ─── Generate initial tables ─────────────────────

function generateTables(tableNumbers?: number[]): TableState[] {
  const now = Date.now();
  const ids = tableNumbers || Array.from({ length: TABLE_COUNT }, (_, i) => i + 1);
  return ids.map((num) => ({
    id: num,
    status: "empty" as const,
    guestCount: 0,
    sessionStart: now,
    currentOrderValue: 0,
    engagementScore: 0,
    itemsViewed: 0,
    itemsOrdered: 0,
    lastActivity: now,
    alerts: [],
  }));
}

// ─── Update table states from orders ─────────────

// Module-level active sessions cache — updated by polling
let _activeSessions: { tableNumber: number | null; guestCount: number; openedAt: string; menuOpenedAt?: string | null }[] = [];

export function setActiveSessions(sessions: { tableNumber: number | null; guestCount: number; openedAt: string; menuOpenedAt?: string | null; status: string }[]) {
  _activeSessions = sessions.filter((s) => s.status === "OPEN");
}

function updateTablesFromOrders(tables: TableState[], orders: LiveOrder[]): TableState[] {
  const tableMap = new Map(tables.map((t) => [t.id, { ...t }]));

  // Reset all to empty first
  for (const table of tableMap.values()) {
    table.status = "empty";
    table.guestCount = 0;
    table.currentOrderValue = 0;
    table.itemsOrdered = 0;
    table.orderId = undefined;
    table.sessionStart = Date.now(); // Reset so idle tables don't show stale timers
  }

  // Mark tables with open sessions as "seated" or "browsing" (skip VIP sessions with no table)
  for (const session of _activeSessions) {
    if (session.tableNumber == null) continue;
    const table = tableMap.get(session.tableNumber);
    if (!table) continue;
    table.status = session.menuOpenedAt ? "browsing" : "seated";
    table.guestCount = session.guestCount;
    table.sessionStart = new Date(session.openedAt).getTime();
    table.lastActivity = session.menuOpenedAt ? new Date(session.menuOpenedAt).getTime() : new Date(session.openedAt).getTime();
  }

  const activeTableNumbers = new Set(_activeSessions.map((s) => s.tableNumber).filter((n): n is number => n != null));

  for (const order of orders) {
    if (order.tableNumber == null) continue;
    const table = tableMap.get(order.tableNumber);
    if (!table) continue;
    if (!activeTableNumbers.has(order.tableNumber)) continue;

    // "eating" renders as "Served" on the floor map, so we only flip
    // the table into it once the waiter has actually delivered (status
    // SERVED). READY means the kitchen is done but the food is still
    // on the pass — the table should stay "Ordered" until a human
    // carries the plate over.
    const statusMap: Record<string, TableState["status"]> = {
      pending: "ordered",
      confirmed: "ordered",
      preparing: "ordered",
      ready: "ordered",
      served: "eating",
      paid: "empty",
    };

    const tableStatus = statusMap[order.status] || "empty";
    if (tableStatus === "empty") continue;

    // Set sessionStart to earliest order time for this table
    if (table.status === "empty" || table.status === "seated" || table.status === "browsing" || order.createdAt < table.sessionStart) {
      table.sessionStart = order.createdAt;
    }
    table.status = tableStatus;
    table.guestCount = Math.max(table.guestCount, 1);
    table.currentOrderValue += order.total;
    table.itemsOrdered += order.items.reduce((s, i) => s + i.quantity, 0);
    table.orderId = order.id;
    table.lastActivity = order.createdAt;
  }

  return Array.from(tableMap.values());
}

// ─── The hook ────────────────────────────────────

// Module-level state — shared across all component instances
let stopOrchestrator: (() => void) | null = null;
let stopSnapshotPoll: (() => void) | null = null;
let connectionCount = 0;
let _liveDataStaffId: string | null = null;

// ─── Sync orders from API into stores ───────────

type RawOrder = {
  id: string;
  orderNumber: number;
  tableNumber: number;
  items: { id?: string; menuItemId?: string; name: string; quantity: number; price: number; wasUpsell?: boolean }[];
  total: number;
  status: string;
  createdAt: string;
  notes?: string;
  sessionId?: string;
  paymentMethod?: string;
  source?: string;
};

function syncOrdersFromAPI(rawOrders: RawOrder[]) {
  const freshOrders = rawOrders.map(toLiveOrder);
  const state = usePerception.getState();

  // Build a map of fresh orders by ID
  const freshMap = new Map(freshOrders.map((o) => [o.id, o]));
  const freshIds = new Set(freshOrders.map((o) => o.id));

  // Update existing real orders + remove stale ones
  const merged: LiveOrder[] = [];

  for (const o of state.orders) {
    const fresh = freshMap.get(o.id);
    if (!fresh) continue; // Order no longer in API (paid/removed) — drop it
    // If API items are richer/different (SSE events can stash name-less stubs),
    // always prefer the fresh items — otherwise preserve local state.
    const itemsChanged =
      fresh.items.length !== o.items.length ||
      fresh.items.some((fi, i) => fi.name !== o.items[i]?.name || fi.quantity !== o.items[i]?.quantity);
    if (
      fresh.status !== o.status ||
      fresh.notes !== o.notes ||
      fresh.paymentMethod !== o.paymentMethod ||
      itemsChanged
    ) {
      merged.push({
        ...o,
        status: fresh.status,
        notes: fresh.notes,
        paymentMethod: fresh.paymentMethod,
        items: itemsChanged ? fresh.items : o.items,
      });
    } else {
      merged.push(o);
    }
  }

  // Add orders from API that we don't have locally
  const existingIds = new Set(merged.map((o) => o.id));
  for (const fresh of freshOrders) {
    if (!existingIds.has(fresh.id)) {
      merged.push(fresh);
    }
  }

  const tables = updateTablesFromOrders(state.tableStates, merged);
  const { metrics, kitchen, bar, orderCounts } = computeMetrics(merged, tables);
  usePerception.setState({ orders: merged, tableStates: tables, metrics, kitchen, bar });
  useAction.setState({ orderCounts });
}

function authFetch(url: string) {
  const headers: Record<string, string> = {};
  if (_liveDataStaffId) headers["x-staff-id"] = _liveDataStaffId;
  return fetch(url, { headers });
}

export function useLiveData(staffId?: string) {
  // Update module-level staffId on every render so late-arriving IDs
  // (e.g. dashboard fetches ownerId async) are picked up by the next poll.
  if (staffId) _liveDataStaffId = staffId;

  useEffect(() => {
    connectionCount++;
    if (connectionCount > 1) return; // Already connected

    // Initial fetch — load tables from API, then orders
    const initSlug = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";

    // Fetch kitchen config (per-restaurant capacity settings)
    fetch(`/api/restaurant/kitchen-config?restaurantId=${initSlug}`)
      .then((res) => res.json())
      .then((data) => setKitchenConfig(data))
      .catch(() => {});

    // Single combined snapshot fetch — replaces 3 separate calls to
    // /api/orders, /api/sessions/all, /api/tables. Cuts invocations 3×
    // per poll cycle. SSE has been removed: on Vercel it never actually
    // streamed (functions hit max duration and reconnect) and polling
    // already catches every change.
    type SnapshotResp = {
      orders?: RawOrder[];
      sessions?: { tableNumber: number; guestCount: number; openedAt: string; menuOpenedAt?: string | null; status: string }[];
      tables?: { number: number }[];
      tipsToday?: number;
    };

    const applySnapshot = (snap: SnapshotResp, initial: boolean) => {
      // Sessions first — updateTablesFromOrders depends on _activeSessions
      if (snap.sessions) setActiveSessions(snap.sessions);

      if (snap.tables && snap.tables.length > 0) {
        const tableNumbers = snap.tables.map((t) => t.number);
        const newCount = tableNumbers.length;
        if (initial) {
          TABLE_COUNT = newCount;
          usePerception.getState().setTables(generateTables(tableNumbers));
        } else if (newCount !== TABLE_COUNT) {
          TABLE_COUNT = newCount;
          const state = usePerception.getState();
          const existing = new Map(state.tableStates.map((t) => [t.id, t]));
          const now = Date.now();
          const updated = tableNumbers.map((num) => existing.get(num) || {
            id: num, status: "empty" as const, guestCount: 0, sessionStart: now,
            currentOrderValue: 0, engagementScore: 0, itemsViewed: 0, itemsOrdered: 0,
            lastActivity: now, alerts: [],
          });
          usePerception.setState({ tableStates: updated });
        }
      } else if (initial) {
        usePerception.getState().setTables(generateTables());
      }

      if (snap.orders) {
        if (initial) {
          const orders = snap.orders.map(toLiveOrder);
          const currentTables = usePerception.getState().tableStates;
          const baseTables = currentTables.length > 0 ? currentTables : generateTables();
          const tables = updateTablesFromOrders(baseTables, orders);
          const { metrics, kitchen, bar, orderCounts } = computeMetrics(orders, tables);
          // Server-computed aggregate, overlays client-derived metrics.
          // Tips can't be summed client-side because /api/live-snapshot
          // returns at most 50 orders — tips earlier in the day would be
          // missed. Server does the real aggregate and we trust it.
          const withTips = { ...metrics, tipsToday: snap.tipsToday ?? 0 };
          usePerception.setState({ orders, tableStates: tables, metrics: withTips, kitchen, bar });
          useAction.setState({ orderCounts });
        } else {
          syncOrdersFromAPI(snap.orders);
          if (typeof snap.tipsToday === "number") {
            const cur = usePerception.getState().metrics;
            usePerception.setState({ metrics: { ...cur, tipsToday: snap.tipsToday } });
          }
        }
      }
    };

    // Initial snapshot
    authFetch(`/api/live-snapshot?restaurantId=${initSlug}`)
      .then((res) => res.json())
      .then((snap: SnapshotResp) => applySnapshot(snap, true))
      .catch((err) => {
        console.error("Initial snapshot failed:", err);
        usePerception.getState().setTables(generateTables());
      });

    // Snapshot poll — every 30s, paused when tab is hidden, immediate
    // refresh when the tab returns. History: 5s → 20s → 30s. Each step
    // halved Neon compute burn for no perceptible UX change; the
    // orchestrator/UI already handles 30s freshness fine.
    const restaurantSlug = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";
    stopSnapshotPoll = startPoll(() => {
      authFetch(`/api/live-snapshot?restaurantId=${restaurantSlug}`)
        .then((res) => res.json())
        .then((snap: SnapshotResp) => applySnapshot(snap, false))
        .catch(() => {});
    }, 30000);

    // ─── Orchestrator tick every 20s ────────────────
    // Purely local — no network — but we still pause it when hidden
    // so background tabs don't burn battery running the ranking loop.
    stopOrchestrator = startPoll(() => {
      const now = Date.now();
      const fullPerception = usePerception.getState();
      const actionState = useAction.getState();
      const boostedIds = new Set(
        actionState.boostedItems
          .filter((b) => b.expiresAt > now)
          .map((b) => b.itemId)
      );

      orchestratorTick();

      const orchState = useSystemState.getState();
      const ranking = rankMenuItems(fullPerception, new Date().getHours(), boostedIds, orchState.hiddenItemIds);
      useAction.setState({ menuRanking: ranking });
    }, 20000);

    return () => {
      connectionCount--;
      if (connectionCount <= 0) {
        if (stopOrchestrator) { stopOrchestrator(); stopOrchestrator = null; }
        if (stopSnapshotPoll) { stopSnapshotPoll(); stopSnapshotPoll = null; }
        connectionCount = 0;
      }
    };
  }, []);
}
