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
  // PENDING JoinRequests across the whole restaurant. Surfaced in the
  // floor view's "stuck at gate" banner — guests scanning an existing
  // table whose owner is away (pool / sea / phone in pocket). Polled
  // every 10s so the floor manager can admit them in near-real-time
  // without the guest physically tracking down a staff member.
  const [pendingJoinRequests, setPendingJoinRequests] = useState<{
    id: string;
    guestId: string;
    sessionId: string;
    createdAt: string;
    tableNumber: number | null;
    vipGuestName: string | null;
    orderType: string;
    guestCount: number;
  }[]>([]);
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());
  // Restaurant-wide waiter-app flag. Drives whether the floor view
  // shows the Reassign action and any other waiter-only affordances.
  // Fetched once on mount; re-fetched on visibility change so a
  // toggle in the dashboard reaches the floor view within seconds.
  const [waiterAppEnabled, setWaiterAppEnabled] = useState<boolean>(true);
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

  // Read the restaurant flag once on mount + on visibility flip back
  // to the tab. Cheap (SWR-cached server-side); good enough for an
  // owner-toggle propagation delay measured in seconds.
  useEffect(() => {
    let cancelled = false;
    async function fetchFlag() {
      try {
        const res = await fetch(`/api/restaurant?slug=${RESTAURANT_SLUG}`, { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (typeof data.waiterAppEnabled === "boolean") setWaiterAppEnabled(data.waiterAppEnabled);
      } catch { /* keep the previous value on network blip */ }
    }
    fetchFlag();
    const onVisible = () => { if (document.visibilityState === "visible") fetchFlag(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { cancelled = true; document.removeEventListener("visibilitychange", onVisible); };
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

  // Pending join requests. 10s cadence — the typical "stuck at gate"
  // experience is short (the friend stands at the table phone in
  // hand), so the floor manager wants to see them quickly. The
  // endpoint is restricted to OWNER / FLOOR_MANAGER server-side.
  useEffect(() => {
    let cancelled = false;
    async function fetchPending() {
      try {
        const res = await staffFetch(loggedInStaff.id, `/api/sessions/join?scope=all&restaurantId=${RESTAURANT_SLUG}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setPendingJoinRequests(data.requests || []);
        }
      } catch {}
    }
    fetchPending();
    const stop = startPoll(fetchPending, 10000);
    return () => { cancelled = true; stop(); };
  }, [loggedInStaff.id]);

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

  const handleReassign = useCallback(async (sessionId: string, waiterId: string): Promise<{ ok: boolean; message?: string }> => {
    try {
      const res = await staffFetch(loggedInStaff.id, "/api/sessions", {
        method: "PATCH",
        body: JSON.stringify({ sessionId, action: "assign_waiter", waiterId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { ok: false, message: data.message || data.error || "Assign failed" };
      }
      const s = sessions.find((ss) => ss.id === sessionId);
      const w = allStaff.find((st) => st.id === waiterId);
      logAction("reassign", `Reassigned T${s?.tableNumber ?? "?"} → ${w?.name ?? "?"}`, sessionId);
      refreshSessions();
      return { ok: true };
    } catch {
      return { ok: false, message: "Network error" };
    }
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

  // Move a single named guest with all their orders (placed, served,
  // even already-paid) from one table session to another. The server
  // resolves the target session — joining an existing one or creating
  // a fresh one — based on the target table's current state.
  const handleMoveGuest = useCallback(async (
    sessionId: string,
    guest: { guestNumber: number | null; guestName: string | null },
    targetTableNumber: number,
  ) => {
    try {
      const res = await staffFetch(loggedInStaff.id, "/api/sessions", {
        method: "PATCH",
        body: JSON.stringify({
          sessionId,
          action: "move_guest",
          guestNumber: guest.guestNumber ?? undefined,
          guestName: guest.guestName ?? undefined,
          targetTableNumber,
        }),
      });
      if (!res.ok) return { ok: false, message: (await res.json().catch(() => ({}))).error || "Move failed" };
      const s = sessions.find((ss) => ss.id === sessionId);
      const guestLabel = guest.guestName?.trim() || `Guest ${guest.guestNumber ?? "?"}`;
      logAction("change_table", `${guestLabel}: T${s?.tableNumber ?? "?"} → T${targetTableNumber}`, sessionId);
      refreshSessions();
      return { ok: true };
    } catch {
      return { ok: false, message: "Network error" };
    }
  }, [loggedInStaff.id, sessions, logAction, refreshSessions]);

  // Admit (approve) a stuck-at-gate guest's join request. Floor
  // manager / owner override — bypasses the session-owner approval
  // path. Optimistically clears the request from the local list so
  // the banner collapses immediately; the next poll reconciles with
  // server state.
  const handleAdmitJoinRequest = useCallback(async (requestId: string) => {
    try {
      setPendingJoinRequests((prev) => prev.filter((r) => r.id !== requestId));
      const res = await staffFetch(loggedInStaff.id, "/api/sessions/join", {
        method: "PATCH",
        body: JSON.stringify({ requestId, action: "approve" }),
      });
      if (!res.ok) {
        // Restore on failure so the banner shows again.
        await refreshSessions();
        const refetch = await staffFetch(loggedInStaff.id, `/api/sessions/join?scope=all&restaurantId=${RESTAURANT_SLUG}`);
        if (refetch.ok) {
          const data = await refetch.json();
          setPendingJoinRequests(data.requests || []);
        }
        return { ok: false, message: "Admit failed" };
      }
      logAction("change_table", `Admitted guest at T${pendingJoinRequests.find((r) => r.id === requestId)?.tableNumber ?? "?"}`);
      return { ok: true };
    } catch {
      return { ok: false, message: "Network error" };
    }
  }, [loggedInStaff.id, pendingJoinRequests, refreshSessions, logAction]);

  // Reject a stuck-at-gate join request. Same gate as admit (staff
  // override), but stamps REJECTED instead of APPROVED — used when
  // the floor manager recognises the requester as not part of the
  // group (e.g. a wandering guest who scanned the wrong QR).
  const handleRejectJoinRequest = useCallback(async (requestId: string) => {
    try {
      setPendingJoinRequests((prev) => prev.filter((r) => r.id !== requestId));
      const res = await staffFetch(loggedInStaff.id, "/api/sessions/join", {
        method: "PATCH",
        body: JSON.stringify({ requestId, action: "reject" }),
      });
      if (!res.ok) return { ok: false, message: "Reject failed" };
      return { ok: true };
    } catch {
      return { ok: false, message: "Network error" };
    }
  }, [loggedInStaff.id]);

  // Merge two tables: source folds INTO target, source closes. Used
  // when one group physically joins another. The UI passes the picked-
  // up table as source and the destination as target.
  const handleMergeTables = useCallback(async (
    sourceSessionId: string,
    targetSessionId: string,
  ) => {
    try {
      const res = await staffFetch(loggedInStaff.id, "/api/sessions", {
        method: "PATCH",
        body: JSON.stringify({
          sessionId: sourceSessionId,
          action: "merge_tables",
          targetSessionId,
        }),
      });
      if (!res.ok) return { ok: false, message: (await res.json().catch(() => ({}))).error || "Merge failed" };
      const src = sessions.find((ss) => ss.id === sourceSessionId);
      const tgt = sessions.find((ss) => ss.id === targetSessionId);
      logAction(
        "change_table",
        `Merged T${src?.tableNumber ?? "?"} → T${tgt?.tableNumber ?? "?"}`,
        targetSessionId,
      );
      refreshSessions();
      return { ok: true };
    } catch {
      return { ok: false, message: "Network error" };
    }
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
    pendingJoinRequests,
    waiterAppEnabled,
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
    handleCancelItem, handleChangeTable, handleMoveGuest, handleMergeTables,
    handleAdmitJoinRequest, handleRejectJoinRequest,
    handleIncrementGuests, handleAdvanceStatus,
    handleAssignDriver, handleUpdateDeliveryStatus, handleBroadcast, handleLogIssue,
    handleAlertAction, handleDismissAlert,
  };
}

export type FloorData = ReturnType<typeof useFloorData>;
