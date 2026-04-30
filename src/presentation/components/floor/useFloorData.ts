"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePerception } from "@/lib/engine/perception";
import { useLiveData } from "@/lib/use-live-data";
import { generateFloorAlerts, type FloorAlert } from "@/lib/floor-alerts";
import { getShiftTimer } from "@/lib/shifts";
import { RESTAURANT_SLUG } from "@/lib/restaurant-config";
import { staffFetch } from "@/lib/staff-fetch";
import { startPoll } from "@/lib/polling";
import { minsAgo } from "./constants";
import type {
  ActionLogEntry,
  DeliveryOrder,
  LoggedInStaff,
  RecentMessage,
  SessionInfo,
  StaffInfo,
  StaffPresence,
  WaiterLoad,
  WaiterMetric,
} from "./types";

// Central data + mutation hook for the Floor Manager view. Owns every
// poll, every handler, and every derived metric so the UI components
// stay pure and receive plain props. Not generic — this is tailored to
// the shape the FloorManagerView renders.
export function useFloorData(loggedInStaff: LoggedInStaff) {
  const perception = usePerception();
  const { tableStates: tables, orders, kitchen, bar, metrics } = perception;
  useLiveData(loggedInStaff.id);

  // ─── Raw state ─────────────────────────────────────
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [allStaff, setAllStaff] = useState<StaffInfo[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryOrder[]>([]);
  const [recentMessages, setRecentMessages] = useState<RecentMessage[]>([]);
  const [clockedInIds, setClockedInIds] = useState<Set<string>>(new Set());
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(Date.now());
  const [commsText, setCommsText] = useState("");
  const [commsTarget, setCommsTarget] = useState<string>("all");
  const [actionHistory, setActionHistory] = useState<ActionLogEntry[]>([]);
  const lastMsgPoll = useRef(Date.now() - 60000);

  const shiftInfo = getShiftTimer(loggedInStaff.shift);

  // ─── Clock tick ────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ─── Polls ─────────────────────────────────────────
  // All polls use startPoll: ticks pause when the tab is hidden, and a
  // single fresh fetch fires when it becomes visible again. Floor
  // tablets live in standby a lot — this is where most of the cost
  // savings come from.
  useEffect(() => {
    let cancelled = false;
    async function fetchSessions() {
      try {
        const res = await staffFetch(loggedInStaff.id, `/api/sessions/all?restaurantId=${RESTAURANT_SLUG}`, { method: "GET" });
        if (res.ok && !cancelled) setSessions((await res.json()).sessions || []);
      } catch {}
    }
    fetchSessions();
    const stop = startPoll(fetchSessions, 20000);
    return () => { cancelled = true; stop(); };
  }, [loggedInStaff.id]);

  useEffect(() => {
    let cancelled = false;
    async function fetchStaff() {
      try {
        const res = await fetch(`/api/staff?restaurantId=${RESTAURANT_SLUG}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setAllStaff(data.staff || data || []);
        }
      } catch {}
    }
    fetchStaff();
    const stop = startPoll(fetchStaff, 30000);
    return () => { cancelled = true; stop(); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchDeliveries() {
      try {
        const res = await fetch(`/api/delivery?restaurantId=${RESTAURANT_SLUG}`);
        if (res.ok && !cancelled) setDeliveries(await res.json());
      } catch {}
    }
    fetchDeliveries();
    const stop = startPoll(fetchDeliveries, 20000);
    return () => { cancelled = true; stop(); };
  }, []);

  // Clocked-in staff IDs — feeds the green/red bulb on every staff row
  // in the Staff panel. cache:no-store so a clock-out elsewhere lands
  // on the next poll instead of a stale browser response.
  useEffect(() => {
    let cancelled = false;
    async function fetchClocked() {
      try {
        const res = await fetch(`/api/clock?restaurantId=${RESTAURANT_SLUG}`, { cache: "no-store" });
        if (res.ok && !cancelled) {
          const data = await res.json();
          setClockedInIds(new Set<string>(data.openStaffIds || []));
        }
      } catch {}
    }
    fetchClocked();
    const stop = startPoll(fetchClocked, 30000);
    return () => { cancelled = true; stop(); };
  }, []);

  useEffect(() => {
    return startPoll(() => {
      fetch(`/api/messages?since=${lastMsgPoll.current}&to=${loggedInStaff.id}&restaurantId=${RESTAURANT_SLUG}`)
        .then((res) => res.json())
        .then((msgs: RecentMessage[]) => {
          if (msgs.length > 0) {
            lastMsgPoll.current = Math.max(...msgs.map((m) => m.createdAt));
            setRecentMessages((prev) => {
              const seen = new Set(prev.map((m) => m.id));
              const fresh = msgs.filter((m) => !seen.has(m.id));
              if (fresh.length === 0) return prev;
              return [...fresh, ...prev].slice(0, 50);
            });
          }
        })
        .catch(() => {});
    }, 15000);
  }, [loggedInStaff.id]);

  // ─── Derivations ───────────────────────────────────
  const openSessions = useMemo(() => sessions.filter((s) => s.status === "OPEN"), [sessions]);
  const vipSessions = useMemo(() => openSessions.filter((s) => s.orderType === "VIP_DINE_IN" || s.orderType === "DELIVERY"), [openSessions]);
  const occupied = useMemo(() => tables.filter((tb) => tb.status !== "empty").length, [tables]);
  const totalGuests = useMemo(() => openSessions.reduce((s, se) => s + se.guestCount, 0), [openSessions]);
  const cookingCount = useMemo(() => orders.filter((o) => o.status === "preparing").length, [orders]);
  const readyCount = useMemo(() => orders.filter((o) => o.status === "ready").length, [orders]);

  const unassignedDeliveries = useMemo(
    () => deliveries.filter((d) => !d.deliveryDriverId && d.status !== "PENDING" && d.status !== "CANCELLED" && d.status !== "PAID"),
    [deliveries],
  );

  const activeOrders = useMemo(() => {
    return orders
      .filter((o) => !["paid", "cancelled", "served"].includes(o.status))
      .sort((a, b) => {
        const priority: Record<string, number> = { ready: 0, preparing: 1, confirmed: 2, pending: 3 };
        const pa = priority[a.status] ?? 4;
        const pb = priority[b.status] ?? 4;
        if (pa !== pb) return pa - pb;
        if (a.status === "preparing" && b.status === "preparing") {
          const aStuck = now - a.createdAt > 15 * 60000;
          const bStuck = now - b.createdAt > 15 * 60000;
          if (aStuck !== bStuck) return aStuck ? -1 : 1;
        }
        return a.createdAt - b.createdAt;
      });
  }, [orders, now]);

  const urgentOrders = useMemo(
    () => activeOrders.filter((o) => o.status === "ready" || (o.status === "preparing" && minsAgo(o.createdAt) > 10)),
    [activeOrders],
  );

  const routineOrders = useMemo(
    () => activeOrders.filter((o) => !urgentOrders.includes(o)),
    [activeOrders, urgentOrders],
  );

  const alerts = useMemo(() => {
    const raw = generateFloorAlerts(tables, orders, sessions, allStaff, kitchen.capacity, now);
    return raw.filter((a) => !dismissedAlerts.has(a.id));
  }, [tables, orders, sessions, allStaff, kitchen.capacity, now, dismissedAlerts]);

  const criticalCount = useMemo(() => alerts.filter((a) => a.severity === "critical").length, [alerts]);
  const warningCount = useMemo(() => alerts.filter((a) => a.severity === "warning").length, [alerts]);

  const waiterMetrics = useMemo<WaiterMetric[]>(() => {
    return allStaff
      .filter((s) => s.role === "WAITER" && s.active)
      .map((s) => {
        const mine = openSessions.filter((ss) => ss.waiterId === s.id);
        const tablesCount = mine.length;
        const openRevenue = mine.reduce((acc, ss) => acc + (ss.unpaidTotal || 0), 0);
        const myOrders = orders.filter((o) =>
          !["paid", "cancelled", "served"].includes(o.status) && mine.some((ss) =>
            (o.sessionId && ss.id === o.sessionId) ||
            (o.tableNumber != null && ss.tableNumber === o.tableNumber)
          )
        );
        const lastActivityTs = myOrders.reduce<number | null>(
          (acc, o) => (acc == null || o.createdAt > acc ? o.createdAt : acc),
          null,
        );
        return {
          id: s.id,
          name: s.name,
          shift: s.shift,
          onShift: getShiftTimer(s.shift, s.role).isOnShift,
          isClockedIn: clockedInIds.has(s.id),
          tables: tablesCount,
          activeOrders: myOrders.length,
          openRevenue,
          load: (tablesCount === 0 ? "idle"
            : tablesCount <= 2 ? "busy"
            : tablesCount <= 4 ? "heavy"
            : "overloaded") as WaiterLoad,
          lastActivityMins: lastActivityTs != null ? minsAgo(lastActivityTs) : null,
        };
      })
      .sort((a, b) => {
        if (a.onShift !== b.onShift) return a.onShift ? -1 : 1;
        return b.tables - a.tables;
      });
  }, [allStaff, openSessions, orders, clockedInIds]);

  // Presence list for non-waiter roles — same clock/shift signals as the
  // waiter radar, minus the per-waiter load math. Lets the Staff panel
  // show cashiers / bar / kitchen / delivery in the same place.
  const staffPresence = useMemo<StaffPresence[]>(() => {
    return allStaff
      .filter((s) => s.active && s.role !== "WAITER" && s.role !== "OWNER")
      .map((s) => ({
        id: s.id,
        name: s.name,
        role: s.role,
        shift: s.shift,
        onShift: getShiftTimer(s.shift, s.role).isOnShift,
        isClockedIn: clockedInIds.has(s.id),
      }))
      .sort((a, b) => {
        if (a.onShift !== b.onShift) return a.onShift ? -1 : 1;
        if (a.role !== b.role) return a.role.localeCompare(b.role);
        return a.name.localeCompare(b.name);
      });
  }, [allStaff, clockedInIds]);

  const loadSummary = useMemo(() => {
    const onShift = waiterMetrics.filter((w) => w.onShift);
    return {
      idle: onShift.filter((w) => w.load === "idle").length,
      busy: onShift.filter((w) => w.load === "busy").length,
      heavy: onShift.filter((w) => w.load === "heavy").length,
      overloaded: onShift.filter((w) => w.load === "overloaded").length,
      total: onShift.length,
    };
  }, [waiterMetrics]);

  const highValueTables = useMemo(() => {
    return openSessions
      .filter((s) => s.tableNumber != null && (s.unpaidTotal || 0) > 0)
      .slice()
      .sort((a, b) => (b.unpaidTotal || 0) - (a.unpaidTotal || 0))
      .slice(0, 3);
  }, [openSessions]);

  const revenuePerHour = useMemo(() => {
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    if (h < 0.2 || metrics.revenueToday === 0) return 0;
    return Math.round(metrics.revenueToday / h);
  }, [metrics.revenueToday]);

  const shiftProgressPct = useMemo(() => {
    if (loggedInStaff.shift === 0) return 0;
    const total = 480;
    const elapsed = Math.max(0, Math.min(total, total - shiftInfo.minutesRemaining));
    return Math.round((elapsed / total) * 100);
  }, [shiftInfo.minutesRemaining, loggedInStaff.shift]);

  // ─── Action log ────────────────────────────────────
  const logAction = useCallback((kind: ActionLogEntry["kind"], label: string, target?: string) => {
    setActionHistory((prev) => [
      { id: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, kind, label, target, timestamp: Date.now() },
      ...prev,
    ].slice(0, 100));
  }, []);

  // ─── Mutations ─────────────────────────────────────
  const refreshSessions = useCallback(async () => {
    try {
      const res = await staffFetch(loggedInStaff.id, `/api/sessions/all?restaurantId=${RESTAURANT_SLUG}`, { method: "GET" });
      if (res.ok) setSessions((await res.json()).sessions || []);
    } catch {}
  }, [loggedInStaff.id]);

  const handleReassign = useCallback(async (sessionId: string, waiterId: string) => {
    try {
      await staffFetch(loggedInStaff.id, "/api/sessions", {
        method: "PATCH",
        body: JSON.stringify({ sessionId, action: "assign_waiter", waiterId }),
      });
      const s = sessions.find((ss) => ss.id === sessionId);
      const w = allStaff.find((st) => st.id === waiterId);
      logAction("reassign", `Reassigned T${s?.tableNumber ?? "?"} → ${w?.name ?? "?"}`, sessionId);
      refreshSessions();
    } catch {}
  }, [loggedInStaff.id, sessions, allStaff, logAction, refreshSessions]);

  const handleSendWaiter = useCallback(async (tableId: number) => {
    const session = sessions.find((s) => s.tableNumber === tableId && s.status === "OPEN");
    try {
      await staffFetch(loggedInStaff.id, "/api/messages", {
        method: "POST",
        body: JSON.stringify({
          type: "command", from: loggedInStaff.id,
          to: session?.waiterId || "all",
          command: "call_waiter", tableId,
          restaurantId: RESTAURANT_SLUG,
        }),
      });
      logAction("send_waiter", `Sent waiter to T${tableId}`);
    } catch {}
  }, [loggedInStaff.id, sessions, logAction]);

  const handlePrioritize = useCallback(async (orderId: string) => {
    try {
      await staffFetch(loggedInStaff.id, "/api/messages", {
        method: "POST",
        body: JSON.stringify({
          type: "command", from: loggedInStaff.id, to: "kitchen",
          command: "prioritize", orderId, restaurantId: RESTAURANT_SLUG,
        }),
      });
      const o = orders.find((oo) => oo.id === orderId);
      logAction("prioritize", `Prioritized #${o?.orderNumber ?? "?"}${o?.tableNumber ? ` · T${o.tableNumber}` : ""}`);
    } catch {}
  }, [loggedInStaff.id, orders, logAction]);

  const handleEndSession = useCallback(async (sessionId: string) => {
    try {
      await staffFetch(loggedInStaff.id, "/api/sessions", {
        method: "PATCH",
        body: JSON.stringify({ sessionId, action: "close" }),
      });
      const s = sessions.find((ss) => ss.id === sessionId);
      logAction("end_session", `Closed T${s?.tableNumber ?? "?"}`, sessionId);
      refreshSessions();
    } catch {}
  }, [loggedInStaff.id, sessions, logAction, refreshSessions]);

  const handleCancelItem = useCallback(async (
    orderId: string, itemId: string, reason: string, action: "cancel" | "comp" = "cancel",
  ) => {
    try {
      await staffFetch(loggedInStaff.id, `/api/orders/${orderId}/items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ action, reason, staffId: loggedInStaff.id }),
      });
      const o = orders.find((oo) => oo.id === orderId);
      logAction(action === "comp" ? "comp_item" : "cancel_item", `${action === "comp" ? "Comped" : "Cancelled"} item on #${o?.orderNumber ?? "?"} — ${reason}`);
      refreshSessions();
    } catch {}
  }, [loggedInStaff.id, orders, logAction, refreshSessions]);

  const handleChangeTable = useCallback(async (sessionId: string, newTableNumber: number) => {
    try {
      await staffFetch(loggedInStaff.id, "/api/sessions", {
        method: "PATCH",
        body: JSON.stringify({ sessionId, action: "change_table", newTableNumber }),
      });
      const s = sessions.find((ss) => ss.id === sessionId);
      logAction("change_table", `Moved T${s?.tableNumber ?? "?"} → T${newTableNumber}`, sessionId);
      refreshSessions();
    } catch {}
  }, [loggedInStaff.id, sessions, logAction, refreshSessions]);

  const handleIncrementGuests = useCallback(async (sessionId: string) => {
    try {
      await staffFetch(loggedInStaff.id, "/api/sessions", {
        method: "PATCH",
        body: JSON.stringify({ sessionId, action: "increment_guests" }),
      });
      const s = sessions.find((ss) => ss.id === sessionId);
      logAction("add_guest", `Added guest to T${s?.tableNumber ?? "?"}`, sessionId);
      refreshSessions();
    } catch {}
  }, [loggedInStaff.id, sessions, logAction, refreshSessions]);

  const handleAdvanceStatus = useCallback(async (orderId: string, status: string) => {
    try {
      await staffFetch(loggedInStaff.id, `/api/orders/${orderId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status, restaurantId: RESTAURANT_SLUG }),
      });
      const o = orders.find((oo) => oo.id === orderId);
      logAction("advance_status", `#${o?.orderNumber ?? "?"} → ${status.toLowerCase()}`);
    } catch {}
  }, [loggedInStaff.id, orders, logAction]);

  const handleAssignDriver = useCallback(async (orderId: string, driverId: string) => {
    try {
      await fetch("/api/delivery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, driverId }),
      });
      const d = deliveries.find((dd) => dd.id === orderId);
      const driver = allStaff.find((st) => st.id === driverId);
      logAction("assign_driver", `Assigned ${driver?.name ?? "driver"} → #${d?.orderNumber ?? "?"}`);
      const res = await fetch(`/api/delivery?restaurantId=${RESTAURANT_SLUG}`);
      if (res.ok) setDeliveries(await res.json());
    } catch {}
  }, [deliveries, allStaff, logAction]);

  const handleUpdateDeliveryStatus = useCallback(async (orderId: string, deliveryStatus: string) => {
    try {
      await staffFetch(loggedInStaff.id, `/api/delivery/${orderId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ deliveryStatus }),
      });
      const d = deliveries.find((dd) => dd.id === orderId);
      logAction("update_delivery", `Delivery #${d?.orderNumber ?? "?"} → ${deliveryStatus.replace(/_/g, " ").toLowerCase()}`);
      const res = await fetch(`/api/delivery?restaurantId=${RESTAURANT_SLUG}`);
      if (res.ok) setDeliveries(await res.json());
    } catch {}
  }, [loggedInStaff.id, deliveries, logAction]);

  const handleBroadcast = useCallback(async (text: string) => {
    try {
      const res = await staffFetch(loggedInStaff.id, "/api/messages", {
        method: "POST",
        body: JSON.stringify({
          type: "alert", from: loggedInStaff.id,
          to: commsTarget, text, restaurantId: RESTAURANT_SLUG,
        }),
      });
      if (!res?.ok) return;
      const msg: RecentMessage = await res.json();
      lastMsgPoll.current = Math.max(lastMsgPoll.current, msg.createdAt);
      setRecentMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [msg, ...prev].slice(0, 50)));
      const targetLabel = commsTarget === "all" ? "all" : (allStaff.find((s) => s.id === commsTarget)?.name || commsTarget);
      logAction("broadcast", `Sent to ${targetLabel}: "${text.slice(0, 40)}${text.length > 40 ? "…" : ""}"`);
    } catch {}
  }, [loggedInStaff.id, commsTarget, allStaff, logAction]);

  const handleLogIssue = useCallback(async (category: string, tableId: number | null, description: string) => {
    const header = `[${category.toUpperCase()}${tableId != null ? ` · T${tableId}` : ""}]`;
    const text = `${header} ${description}`;
    try {
      const res = await staffFetch(loggedInStaff.id, "/api/messages", {
        method: "POST",
        body: JSON.stringify({
          type: "issue", from: loggedInStaff.id, to: "all", text,
          tableId: tableId ?? undefined, restaurantId: RESTAURANT_SLUG,
        }),
      });
      if (res?.ok) {
        const msg: RecentMessage = await res.json();
        lastMsgPoll.current = Math.max(lastMsgPoll.current, msg.createdAt);
        setRecentMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [msg, ...prev].slice(0, 50)));
        logAction("issue", `Logged ${category.toLowerCase()} issue${tableId != null ? ` at T${tableId}` : ""}`);
      }
    } catch {}
  }, [loggedInStaff.id, logAction]);

  // Clock another staff member out from the floor-mgr view. Hits the
  // same /api/clock endpoint the pill button uses. Optimistically drops
  // the id from clockedInIds so the bulb turns red without waiting for
  // the next poll.
  const handleClockOutStaff = useCallback(async (staffId: string) => {
    try {
      const res = await fetch("/api/clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId, action: "out" }),
      });
      if (res.ok) {
        setClockedInIds((prev) => {
          const next = new Set(prev);
          next.delete(staffId);
          return next;
        });
        const who = allStaff.find((s) => s.id === staffId);
        logAction("broadcast", `Clocked out ${who?.name ?? "staff"}`);
      }
    } catch {}
  }, [allStaff, logAction]);

  const handleAlertAction = useCallback((alert: FloorAlert) => {
    if (alert.type === "kitchen_bottleneck") handlePrioritize(alert.orderId || "");
  }, [handlePrioritize]);

  const handleDismissAlert = useCallback((id: string) => {
    setDismissedAlerts((prev) => new Set([...prev, id]));
  }, []);

  return {
    // Perception
    tables, orders, kitchen, bar, metrics,
    // Raw data
    sessions, allStaff, deliveries, recentMessages, now,
    shiftInfo,
    // Comms state (hoisted so footer bar + broadcast handler share it)
    commsText, setCommsText, commsTarget, setCommsTarget,
    // Action log
    actionHistory,
    // Derivations
    openSessions, vipSessions, occupied, totalGuests, cookingCount, readyCount,
    unassignedDeliveries, activeOrders, urgentOrders, routineOrders,
    alerts, criticalCount, warningCount,
    waiterMetrics, loadSummary, highValueTables, revenuePerHour, shiftProgressPct, staffPresence,
    // Handlers
    handleReassign, handleSendWaiter, handlePrioritize, handleEndSession,
    handleCancelItem, handleChangeTable, handleIncrementGuests, handleAdvanceStatus,
    handleAssignDriver, handleUpdateDeliveryStatus, handleBroadcast, handleLogIssue,
    handleAlertAction, handleDismissAlert, handleClockOutStaff,
  };
}

export type FloorData = ReturnType<typeof useFloorData>;
