"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  usePerception,
  type TableState,
  type LiveOrder,
} from "@/lib/engine/perception";
import { nowInRestaurantTz, RESTAURANT_NAME } from "@/lib/restaurant-config";
import { useAction, type ActivePromotion } from "@/lib/engine/action";
import {
  generateInsights,
  analyzeItemPerformance,
  type Insight,
  type ItemPerformance,
} from "@/lib/engine/intelligence";
import { useLiveData } from "@/lib/use-live-data";
import { startPoll } from "@/lib/polling";
import { useSystemState, type DecisionRecord } from "@/lib/engine/orchestrator";
import { useMenu } from "@/store/menu";
import { resolveImage } from "@/lib/placeholders";
import { useLanguage } from "@/lib/use-language";
import { LanguageToggle } from "@/presentation/components/ui/LanguageToggle";
import LogoutButton from "@/presentation/components/ui/LogoutButton";
import { getShiftCount, getShiftLabel, getShiftTimer, getCurrentShift } from "@/lib/shifts";
import { DEFAULT_KITCHEN_CONFIG, normalizeKitchenConfig, type KitchenConfig } from "@/lib/kitchen-config";
import { OwnerManual } from "@/presentation/components/dashboard/OwnerManual";
import { QRCodePanel } from "@/presentation/components/dashboard/QRCodePanel";

// ─── Types ──────────────────────────────────────

type StaffMember = {
  id: string;
  name: string;
  code: string | null; // short unique per-restaurant code (e.g. WAI-482); null for OWNER
  pin: string;
  role: string;
  active: boolean;
  shift: number; // 0=unassigned, 1/2/3
  restaurantId: string;
  createdAt: string;
};

type NavTab = "overview" | "staff" | "controls" | "menu" | "analytics" | "vip" | "books" | "hours" | "manual";

// ─── Helpers ──────────────────────────────────

function formatTime(ms: number) {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "<1m";
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function formatEGP(n: number) {
  return n.toLocaleString("en-EG");
}

function minsAgo(ts: number) {
  return Math.max(0, Math.round((Date.now() - ts) / 60000));
}

// ═════════════════════════════════════════════════
// KPI CARD
// ═════════════════════════════════════════════════

function KpiCard({
  value,
  label,
  unit,
  accent = "text-sand-900",
  sub,
  icon,
  placeholder,
}: {
  value: number;
  label: string;
  unit?: string;
  accent?: string;
  sub?: string;
  icon: string;
  // When set, renders this string in place of the numeric value — used by
  // metrics like Wait Time that have no meaningful zero state (a "0 min"
  // wait misreads as "instant service" instead of "no data yet").
  placeholder?: string;
}) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    const diff = value - display;
    if (Math.abs(diff) < 1) { setDisplay(value); return; }
    const step = diff > 0 ? Math.max(1, Math.ceil(diff / 12)) : Math.min(-1, Math.floor(diff / 12));
    const timer = setTimeout(() => setDisplay((d) => d + step), 20);
    return () => clearTimeout(timer);
  }, [value, display]);

  return (
    <div className="card-luxury p-5 flex flex-col justify-between min-h-[120px]">
      {/* Header — label dominates, icon recedes as accent */}
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] text-text-muted font-extrabold uppercase tracking-[0.18em] leading-tight">
          {label}
        </p>
        <span className="text-xl opacity-60 leading-none flex-shrink-0">{icon}</span>
      </div>

      {/* Hero value — owner glances at this from across the cafe */}
      <div className="mt-3">
        <div className="flex items-baseline gap-1.5">
          <span className={`text-4xl font-extrabold tabular-nums tracking-tight leading-none ${accent}`}>
            {placeholder ?? formatEGP(Math.round(display))}
          </span>
          {unit && !placeholder && (
            <span className="text-sm text-text-muted font-bold leading-none">{unit}</span>
          )}
        </div>
        {sub && (
          <p className="text-[11px] text-text-muted mt-2 font-medium">{sub}</p>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════
// FLOOR MAP
// ═════════════════════════════════════════════════

const TABLE_COLORS: Record<string, { bg: string; border: string; dot: string; label: string }> = {
  empty: { bg: "bg-sand-100", border: "border-sand-200", dot: "bg-sand-300", label: "Idle" },
  seated: { bg: "bg-ocean-50", border: "border-ocean-200", dot: "bg-ocean-400", label: "Seated" },
  browsing: { bg: "bg-ocean-50", border: "border-ocean-300", dot: "bg-ocean-500", label: "Browsing" },
  ordered: { bg: "bg-sunset-400/10", border: "border-sunset-400/40", dot: "bg-sunset-400", label: "Ordered" },
  eating: { bg: "bg-success/5", border: "border-success/30", dot: "bg-success", label: "Served" },
  waiting_bill: { bg: "bg-status-wait-50", border: "border-status-wait-200", dot: "bg-status-wait-400", label: "Bill" },
  paying: { bg: "bg-coral-50", border: "border-coral-200", dot: "bg-coral-400", label: "Paying" },
};

function FloorMap({
  tables,
  orders,
  onSelectTable,
  sessions,
}: {
  tables: TableState[];
  orders: LiveOrder[];
  onSelectTable: (t: TableState) => void;
  sessions?: { tableNumber: number | null; waiterName?: string; status: string }[];
}) {
  const { t } = useLanguage();
  const occupied = tables.filter((tbl) => tbl.status !== "empty").length;
  const totalGuests = tables.reduce((s, tbl) => s + tbl.guestCount, 0);
  const alertCount = tables.reduce((s, tbl) => s + tbl.alerts.filter((a) => a.type !== "high_value").length, 0);

  return (
    <div className="card-luxury p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-text-primary font-bold text-sm flex items-center gap-2">
            {t("dashboard.floorMap")}
            <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
          </h3>
          <p className="text-text-muted text-[11px] mt-0.5">
            {occupied}/{tables.length} tables · {totalGuests} guests
          </p>
        </div>
        {alertCount > 0 && (
          <span className="px-2.5 py-1 rounded-full bg-coral-100 text-coral-600 text-[10px] font-bold animate-pulse">
            {alertCount} alert{alertCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(48px, 1fr))" }}>
        {tables.map((table) => {
          const style = TABLE_COLORS[table.status] || TABLE_COLORS.empty;
          const hasAlert = table.alerts.some((a) => a.type !== "high_value");
          const tableOrder = orders.find((o) => o.tableNumber === table.id && !["paid", "served", "cancelled"].includes(o.status));
          const waitMin = tableOrder ? minsAgo(tableOrder.createdAt) : 0;
          const tableSession = sessions?.find((s) => s.tableNumber === table.id && s.status === "OPEN");

          return (
            <motion.button
              key={table.id}
              onClick={() => onSelectTable(table)}
              className={`relative aspect-square rounded-xl ${style.bg} border-2 ${style.border} flex flex-col items-center justify-center transition-all cursor-pointer group hover:shadow-md ${hasAlert ? "ring-2 ring-coral-400 ring-offset-1" : ""}`}
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.95 }}
            >
              <span className="text-xs font-semibold text-text-secondary group-hover:text-text-primary">{table.id}</span>
              {table.status !== "empty" && (
                <span className="text-[7px] font-bold text-text-muted uppercase">{t(`dashboard.table.${table.status === "waiting_bill" ? "bill" : table.status === "eating" ? "served" : table.status}`)}</span>
              )}
              {table.currentOrderValue > 0 && (
                <span className="text-[7px] font-bold text-success">{table.currentOrderValue}</span>
              )}
              {tableSession?.waiterName && (
                <span className="text-[6px] font-bold text-ocean-600 truncate max-w-full px-0.5">{tableSession.waiterName}</span>
              )}
              {hasAlert && (
                <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-coral-500 animate-pulse" />
              )}
              {tableOrder && waitMin > 10 && (
                <span className="absolute -bottom-1 right-0 text-[7px] font-bold text-coral-600">{waitMin}m</span>
              )}
            </motion.button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-3 mt-4 text-[9px] text-text-muted">
        {[
          { c: "bg-sand-300", k: "dashboard.table.idle" },
          { c: "bg-ocean-400", k: "dashboard.table.seated" },
          { c: "bg-ocean-500", k: "dashboard.table.browsing" },
          { c: "bg-sunset-400", k: "dashboard.table.ordered" },
          { c: "bg-success", k: "dashboard.table.served" },
          { c: "bg-coral-400", k: "dashboard.alert" },
        ].map((s) => (
          <span key={s.k} className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${s.c}`} />
            {t(s.k)}
          </span>
        ))}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════
// FLOOR LAYOUT BUILDER (drag & drop)
// ═════════════════════════════════════════════════


function FloorLayoutBuilder({
  tables,
  orders,
  onSelectTable,
  onAddTable,
  onRemoveTable,
  sessions,
}: {
  tables: TableState[];
  orders: LiveOrder[];
  onSelectTable: (t: TableState) => void;
  onAddTable: () => Promise<void>;
  onRemoveTable: (tableNumber: number) => Promise<boolean>;
  sessions?: { tableNumber: number | null; waiterName?: string; status: string }[];
}) {
  const { t } = useLanguage();
  const [editMode, setEditMode] = useState(false);
  const [addingTable, setAddingTable] = useState(false);
  const [removeError, setRemoveError] = useState("");


  return (
    <div className="card-luxury p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-text-primary font-bold text-sm flex items-center gap-2">
            {t("dashboard.floorLayout")}
          </h3>
          <p className="text-text-muted text-[11px] mt-0.5">
            {editMode ? t("dashboard.addRemoveTables") : t("dashboard.viewFloor")}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          {editMode && (
            <>
              <button
                disabled={addingTable}
                onClick={async () => {
                  setAddingTable(true);
                  setRemoveError("");
                  await onAddTable();
                  setAddingTable(false);
                }}
                className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-success/10 text-success border border-success/30 hover:bg-success/20 transition disabled:opacity-50"
              >
                {addingTable ? "..." : t("dashboard.addTable")}
              </button>
            </>
          )}
          <button
            onClick={() => { setEditMode(!editMode); setRemoveError(""); }}
            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold transition ${
              editMode
                ? "bg-ocean-50 text-ocean-600 border border-ocean-200"
                : "bg-sand-100 text-text-muted border border-sand-200 hover:bg-sand-200"
            }`}
          >
            {editMode ? t("dashboard.done") : t("dashboard.editLayout")}
          </button>
        </div>
      </div>

      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(64px, 1fr))" }}>
        {tables.map((table) => {
          const style = TABLE_COLORS[table.status] || TABLE_COLORS.empty;
          const hasAlert = table.alerts.some((a) => a.type !== "high_value");
          const tableOrder = orders.find((o) => o.tableNumber === table.id && !["paid", "served", "cancelled"].includes(o.status));
          const tableSession = sessions?.find((s) => s.tableNumber === table.id && s.status === "OPEN");

          return (
            <motion.div
              key={table.id}
              className={`relative aspect-square rounded-xl ${style.bg} border-2 ${style.border} flex flex-col items-center justify-center cursor-pointer ${hasAlert ? "ring-2 ring-coral-400 ring-offset-1" : ""}`}
              onClick={() => onSelectTable(table)}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <span className="text-xs font-semibold text-text-secondary">{table.id}</span>
              {table.status !== "empty" && (
                <span className="text-[7px] font-bold text-text-muted uppercase">{t(`dashboard.table.${table.status === "waiting_bill" ? "bill" : table.status === "eating" ? "served" : table.status}`)}</span>
              )}
              {table.currentOrderValue > 0 && (
                <span className="text-[7px] font-bold text-success">{table.currentOrderValue}</span>
              )}
              {tableSession?.waiterName && (
                <span className="text-[5px] font-bold text-ocean-600 truncate max-w-full px-0.5 leading-none">{tableSession.waiterName}</span>
              )}
              {editMode && table.status === "empty" && (
                <button
                  className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-status-bad-500 text-white text-[9px] font-bold flex items-center justify-center z-40 hover:bg-status-bad-600 shadow-sm"
                  onClick={async (e) => {
                    e.stopPropagation();
                    setRemoveError("");
                    const ok = await onRemoveTable(table.id);
                    if (!ok) setRemoveError(`${t("common.table")} ${table.id}`);
                  }}
                  title={`${t("common.table")} ${table.id}`}
                >✕</button>
              )}
              {!editMode && hasAlert && (
                <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-coral-500 animate-pulse" />
              )}
              {tableOrder && minsAgo(tableOrder.createdAt) > 10 && (
                <span className="absolute -bottom-1 right-0 text-[7px] font-bold text-coral-600">
                  {minsAgo(tableOrder.createdAt)}m
                </span>
              )}
            </motion.div>
          );
        })}
      </div>

      {removeError && (
        <p className="text-xs text-coral-600 font-bold mt-2">{removeError}</p>
      )}

      <div className="flex flex-wrap gap-3 mt-4 text-[9px] text-text-muted">
        {[
          { c: "bg-sand-300", k: "dashboard.table.idle" },
          { c: "bg-ocean-400", k: "dashboard.table.seated" },
          { c: "bg-ocean-500", k: "dashboard.table.browsing" },
          { c: "bg-sunset-400", k: "dashboard.table.ordered" },
          { c: "bg-success", k: "dashboard.table.served" },
          { c: "bg-coral-400", k: "dashboard.alert" },
        ].map((s) => (
          <span key={s.k} className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${s.c}`} />
            {t(s.k)}
          </span>
        ))}
        {editMode && (
          <>
            <span className="text-ocean-500 font-bold">Shapes: double-click</span>
            <span className="text-coral-500 font-bold">✕ on idle tables to remove</span>
            <span className="ml-auto text-text-muted font-bold">{tables.length} tables</span>
          </>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════
// TABLE DETAIL MODAL
// ═════════════════════════════════════════════════

type SessionOrder = {
  id: string;
  orderNumber: number;
  status: string;
  tableNumber: number | null;
  station: string;
  groupId: string | null;
  notes: string | null;
  items: {
    id: string;
    menuItemId?: string;
    name: string;
    quantity: number;
    price: number;
    wasUpsell: boolean;
    notes: string | null;
    cancelled: boolean;
    cancelReason: string | null;
  }[];
  total: number;
  createdAt: string;
};

function TableDetailModal({
  table,
  orders,
  onClose,
  onSendWaiter,
  onPrioritize,
  onPushRecommendation,
  sessions,
  staff,
  onAssignTable,
  ownerId,
}: {
  table: TableState;
  orders: LiveOrder[];
  onClose: () => void;
  onSendWaiter: (tableId: number) => void;
  onPrioritize: (orderId: string) => void;
  onPushRecommendation: (tableId: number) => void;
  sessions?: { id: string; tableNumber: number | null; waiterId?: string; waiterName?: string; status: string }[];
  staff?: StaffMember[];
  onAssignTable?: (sessionIdOrTableNumber: string | number, waiterId: string) => Promise<{ ok: boolean; message?: string }> | void;
  ownerId?: string | null;
}) {
  const { t } = useLanguage();
  const [assigningWaiter, setAssigningWaiter] = useState(false);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignBusyId, setAssignBusyId] = useState<string | null>(null);
  const [cancellingItem, setCancellingItem] = useState<{ orderId: string; itemId: string } | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [sessionOrders, setSessionOrders] = useState<SessionOrder[] | null>(null);

  const elapsed = Date.now() - table.sessionStart;
  const tableSession = sessions?.find((s) => s.tableNumber === table.id && s.status === "OPEN");
  const cairoHour = nowInRestaurantTz().getHours();
  const currentShift = cairoHour < 8 ? 1 : cairoHour < 16 ? 2 : 3;
  const waiters = staff?.filter((s) => s.role === "WAITER" && s.active && (s.shift === 0 || s.shift === currentShift)) || [];

  useEffect(() => {
    if (!tableSession?.id) return;
    let stale = false;
    fetch(`/api/sessions/${tableSession.id}/orders`)
      .then((r) => r.json())
      .then((data) => { if (!stale && Array.isArray(data)) setSessionOrders(data); })
      .catch(() => {});
    return () => { stale = true; };
  }, [tableSession?.id]);

  const tableOrders: SessionOrder[] = sessionOrders ||
    orders
      .filter((o) => o.tableNumber === table.id)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        tableNumber: o.tableNumber,
        station: o.station || "KITCHEN",
        groupId: o.groupId || null,
        notes: o.notes || null,
        items: o.items.map((it) => ({
          id: it.id,
          menuItemId: it.id,
          name: it.name,
          quantity: it.quantity,
          price: it.price,
          wasUpsell: it.wasUpsell,
          notes: it.notes || null,
          cancelled: it.cancelled || false,
          cancelReason: it.cancelReason || null,
        })),
        total: o.total,
        createdAt: typeof o.createdAt === "number" ? new Date(o.createdAt).toISOString() : String(o.createdAt),
      }));

  const activeOrder = tableOrders.find((o) => !["cancelled", "paid", "served", "CANCELLED", "PAID", "SERVED"].includes(o.status));

  const liveItems = tableOrders.flatMap((o) =>
    o.status.toUpperCase() !== "CANCELLED" ? o.items.filter((it) => !it.cancelled) : []
  );
  const cancelledItems = tableOrders.flatMap((o) =>
    o.items.filter((it) => it.cancelled)
  );
  const runningTotal = liveItems.reduce((s, it) => s + it.price * it.quantity, 0);
  const lostRevenue = cancelledItems.reduce((s, it) => s + it.price * it.quantity, 0);

  const handleCancelItem = async (orderId: string, itemId: string) => {
    if (!cancelReason.trim()) return;
    setCancelling(true);
    try {
      await ownerFetch(ownerId ?? null, `/api/orders/${orderId}/items/${itemId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "cancel", reason: cancelReason.trim() }),
      });
      if (sessionOrders) {
        setSessionOrders((prev) =>
          prev!.map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  items: o.items.map((it) =>
                    it.id === itemId ? { ...it, cancelled: true, cancelReason: cancelReason.trim() } : it
                  ),
                  ...(o.items.every((it) => it.id === itemId || it.cancelled)
                    ? { status: "CANCELLED" }
                    : {}),
                }
              : o
          )
        );
      }
    } catch { /* silent */ }
    setCancelling(false);
    setCancellingItem(null);
    setCancelReason("");
  };

  const handleCancelWholeOrder = async (orderId: string) => {
    if (!cancelReason.trim()) return;
    setCancelling(true);
    try {
      const restaurantSlug = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";
      await ownerFetch(ownerId ?? null, `/api/orders/${orderId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: "CANCELLED", restaurantId: restaurantSlug, notes: `CANCELLED: ${cancelReason.trim()}` }),
      });
      if (sessionOrders) {
        setSessionOrders((prev) =>
          prev!.map((o) =>
            o.id === orderId
              ? { ...o, status: "CANCELLED", items: o.items.map((it) => ({ ...it, cancelled: true, cancelReason: cancelReason.trim() })) }
              : o
          )
        );
      }
    } catch { /* silent */ }
    setCancelling(false);
    setCancellingItem(null);
    setCancelReason("");
  };

  const cancelReasonKeys = [
    "dashboard.cancelReasons.customerChanged",
    "dashboard.cancelReasons.itemUnavailable",
    "dashboard.cancelReasons.wrongOrder",
    "dashboard.cancelReasons.qualityIssue",
    "dashboard.cancelReasons.tooSlow",
  ] as const;
  const cancelReasons = cancelReasonKeys.map((k) => t?.(k) || k);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end lg:items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        className="relative w-full max-w-lg mx-4 mb-4 lg:mb-0 bg-white rounded-2xl border border-sand-200 overflow-hidden max-h-[85vh] overflow-y-auto shadow-xl"
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm p-5 border-b border-sand-100">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-xl ${TABLE_COLORS[table.status]?.bg} border-2 ${TABLE_COLORS[table.status]?.border} flex items-center justify-center`}>
                <span className="text-text-primary font-semibold text-lg">{table.id}</span>
              </div>
              <div>
                <h3 className="text-text-primary font-bold text-lg">{(t?.("common.table") || "Table") + " "}{table.id}</h3>
                <p className="text-text-muted text-sm">
                  {table.guestCount} {table.guestCount !== 1 ? (t?.("common.guests") || "guests") : (t?.("common.guest") || "guest")} · {formatTime(elapsed)} · {t?.(`dashboard.table.${table.status === "waiting_bill" ? "bill" : table.status === "eating" ? "served" : table.status}`) || TABLE_COLORS[table.status]?.label}
                </p>
              </div>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-sand-100 flex items-center justify-center text-text-muted hover:text-text-primary transition">✕</button>
          </div>
        </div>

        {/* Stats bar */}
        <div className="px-5 pt-4 pb-3 grid grid-cols-4 gap-2">
          <div className="text-center p-2.5 bg-sand-50 rounded-xl">
            <p className="text-base font-semibold text-text-primary">{table.guestCount}</p>
            <p className="text-[9px] text-text-muted font-bold">{t?.("dashboard.guests.label") || "GUESTS"}</p>
          </div>
          <div className="text-center p-2.5 bg-sand-50 rounded-xl">
            <p className="text-base font-semibold text-text-primary">{tableOrders.filter((o) => o.status.toUpperCase() !== "CANCELLED").length}</p>
            <p className="text-[9px] text-text-muted font-bold">{t?.("dashboard.orders.label") || "ORDERS"}</p>
          </div>
          <div className="text-center p-2.5 bg-sand-50 rounded-xl">
            <p className="text-base font-semibold text-success">{formatEGP(runningTotal)}</p>
            <p className="text-[9px] text-text-muted font-bold">{t?.("dashboard.total.label") || "TOTAL"}</p>
          </div>
          <div className="text-center p-2.5 bg-sand-50 rounded-xl">
            <p className="text-base font-semibold text-text-primary">{formatTime(elapsed)}</p>
            <p className="text-[9px] text-text-muted font-bold">{t?.("dashboard.time.label") || "TIME"}</p>
          </div>
        </div>

        {/* Cancellation summary */}
        {cancelledItems.length > 0 && (
          <div className="mx-5 mb-3 p-3 rounded-xl bg-status-bad-50 border border-status-bad-200">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-status-bad-700">{cancelledItems.length} item{cancelledItems.length !== 1 ? "s" : ""} cancelled</span>
              <span className="text-xs font-bold text-status-bad-600">{formatEGP(lostRevenue)} lost</span>
            </div>
          </div>
        )}

        {/* Running receipt — all session orders */}
        {tableOrders.length > 0 && (
          <div className="px-5 pb-4">
            <p className="text-[10px] text-text-muted font-bold uppercase tracking-wider mb-2">{t?.("dashboard.sessionReceipt") || "Session Receipt"}</p>
            <div className="space-y-3">
              {tableOrders.map((order) => {
                const isCancelled = order.status.toUpperCase() === "CANCELLED";
                const statusLower = order.status.toLowerCase();
                const statusColor = isCancelled ? "text-status-bad-500" : statusLower === "paid" ? "text-status-good-600" : statusLower === "ready" ? "text-status-info-600" : statusLower === "served" ? "text-text-muted" : "text-status-warn-600";
                const canCancel = !isCancelled && !["paid", "served"].includes(statusLower);
                const orderLiveTotal = order.items.filter((it) => !it.cancelled).reduce((s, it) => s + it.price * it.quantity, 0);

                return (
                  <div key={order.id} className={`rounded-xl border overflow-hidden ${isCancelled ? "bg-status-bad-50/30 border-status-bad-200 opacity-60" : "bg-sand-50 border-sand-200"}`}>
                    <div className="flex items-center justify-between p-3 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-text-primary">#{order.orderNumber}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase ${
                          isCancelled ? "bg-status-bad-100 text-status-bad-600" : statusLower === "paid" ? "bg-status-good-100 text-status-good-700" : statusLower === "ready" ? "bg-status-info-100 text-status-info-700" : statusLower === "served" ? "bg-sand-100 text-text-secondary" : "bg-status-warn-100 text-status-warn-700"
                        }`}>{statusLower}</span>
                        {order.station === "BAR" && <span className="text-[8px] px-1 py-0.5 rounded bg-status-wait-100 text-status-wait-600 font-bold">BAR</span>}
                      </div>
                      <span className="text-xs font-bold text-text-secondary tabular-nums">{formatEGP(orderLiveTotal)}</span>
                    </div>

                    <div className="px-3 pb-3">
                      {order.items.map((item) => {
                        const isItemCancelled = item.cancelled;
                        const isBeingCancelled = cancellingItem?.orderId === order.id && cancellingItem?.itemId === item.id;

                        return (
                          <div key={item.id}>
                            <div className={`flex items-center justify-between py-1.5 border-b border-sand-100/60 last:border-0 ${isItemCancelled ? "opacity-40" : ""}`}>
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                {isItemCancelled && <span className="text-[8px] px-1 py-0.5 rounded bg-status-bad-100 text-status-bad-500 font-bold flex-shrink-0">{t?.("dashboard.void") || "VOID"}</span>}
                                <span className={`text-xs text-text-secondary ${isItemCancelled ? "line-through" : ""}`}>{item.quantity}x {item.name}</span>
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                <span className={`text-xs text-text-muted tabular-nums ${isItemCancelled ? "line-through" : ""}`}>{formatEGP(item.price * item.quantity)}</span>
                                {canCancel && !isItemCancelled && !isBeingCancelled && (
                                  <button
                                    onClick={() => setCancellingItem({ orderId: order.id, itemId: item.id })}
                                    className="text-[9px] text-status-bad-400 hover:text-status-bad-600 font-bold px-1"
                                  >✕</button>
                                )}
                              </div>
                            </div>
                            {isItemCancelled && item.cancelReason && (
                              <p className="text-[9px] text-status-bad-400 pl-6 -mt-0.5 mb-0.5">{item.cancelReason}</p>
                            )}
                            {isBeingCancelled && (
                              <div className="my-2 p-2.5 rounded-lg bg-status-bad-50 border border-status-bad-200">
                                <p className="text-[10px] font-bold text-status-bad-700 mb-1.5">Cancel {item.name}?</p>
                                <div className="flex gap-1.5 flex-wrap mb-2">
                                  {cancelReasons.map((r) => (
                                    <button key={r} onClick={() => setCancelReason(r)} className={`text-[10px] px-2 py-1 rounded-full border transition ${cancelReason === r ? "bg-status-bad-600 text-white border-status-bad-600" : "bg-white text-status-bad-700 border-status-bad-200"}`}>{r}</button>
                                  ))}
                                </div>
                                <input
                                  value={cancelReason}
                                  onChange={(e) => setCancelReason(e.target.value)}
                                  placeholder={t?.("dashboard.orTypeReason") || "Or type reason..."}
                                  className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-status-bad-200 bg-white mb-2"
                                />
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => handleCancelItem(order.id, item.id)}
                                    disabled={!cancelReason.trim() || cancelling}
                                    className="flex-1 py-1.5 rounded-lg bg-status-bad-600 text-white text-[10px] font-bold disabled:opacity-40"
                                  >{cancelling ? "..." : (t?.("dashboard.cancelItem") || "Cancel Item")}</button>
                                  <button
                                    onClick={() => handleCancelWholeOrder(order.id)}
                                    disabled={!cancelReason.trim() || cancelling}
                                    className="py-1.5 px-2 rounded-lg bg-status-bad-100 text-status-bad-700 text-[10px] font-bold border border-status-bad-200 disabled:opacity-40"
                                  >{t?.("dashboard.cancelOrder") || "Cancel Order"}</button>
                                  <button
                                    onClick={() => { setCancellingItem(null); setCancelReason(""); }}
                                    className="px-2.5 py-1.5 rounded-lg bg-white border border-sand-200 text-text-muted text-[10px] font-bold"
                                  >{t?.("common.back") || "Back"}</button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {order.notes && (
                      <div className="px-3 pb-2 text-[10px] text-sand-600 border-t border-sand-100/60 pt-1.5">Note: {order.notes}</div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Receipt total */}
            <div className="mt-3 pt-2 border-t-2 border-sand-300">
              <div className="flex justify-between">
                <span className="text-sm font-semibold text-text-primary">{t?.("dashboard.sessionTotal") || "Session Total"}</span>
                <span className="text-sm font-semibold text-success">{formatEGP(runningTotal)}</span>
              </div>
              {lostRevenue > 0 && (
                <div className="flex justify-between mt-0.5">
                  <span className="text-[10px] text-status-bad-400">{t?.("dashboard.cancelled") || "Cancelled"}</span>
                  <span className="text-[10px] text-status-bad-400 line-through">{formatEGP(lostRevenue)}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Alerts */}
        {table.alerts.length > 0 && (
          <div className="px-5 pb-3">
            {table.alerts.map((alert, i) => (
              <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg bg-coral-50 border border-coral-200 mb-1.5">
                <div className="w-2 h-2 rounded-full bg-coral-400 animate-pulse" />
                <span className="text-coral-700 text-xs font-medium">{alert.message}</span>
              </div>
            ))}
          </div>
        )}

        {/* Assign to Waiter */}
        {onAssignTable && waiters.length > 0 && (
          <div className="px-5 pb-3">
            <div className="p-3 rounded-xl bg-ocean-50 border border-ocean-200">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-ocean-700">{t?.("dashboard.assignTable") || "Assign Table"}</p>
                {tableSession?.waiterName ? (
                  <span className="text-[10px] text-ocean-500">{t?.("dashboard.currentWaiter") || "Current waiter"}: {tableSession.waiterName}</span>
                ) : !tableSession ? (
                  <span className="text-[10px] text-text-muted">{t?.("dashboard.noActiveSession") || "No active session"}</span>
                ) : null}
              </div>
              {assigningWaiter ? (
                <div className="space-y-1.5">
                  {waiters.map((w) => (
                    <button
                      key={w.id}
                      disabled={assignBusyId !== null}
                      onClick={async () => {
                        setAssignError(null);
                        setAssignBusyId(w.id);
                        const result = await onAssignTable(tableSession ? tableSession.id : table.id, w.id);
                        setAssignBusyId(null);
                        if (result && result.ok === false) {
                          setAssignError(result.message || "Assign failed");
                          return;
                        }
                        setAssigningWaiter(false);
                      }}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs font-bold transition-all disabled:opacity-50 ${
                        tableSession?.waiterId === w.id
                          ? "bg-ocean-200 text-ocean-800"
                          : "bg-white text-text-secondary hover:bg-ocean-100 border border-sand-200"
                      }`}
                    >
                      {w.name} {tableSession?.waiterId === w.id ? "✓" : ""}
                      {assignBusyId === w.id ? " …" : ""}
                    </button>
                  ))}
                  {assignError && (
                    <div className="px-3 py-2 rounded-lg bg-status-bad-50 border border-status-bad-200 text-status-bad-700 text-xs font-semibold">
                      {assignError}
                    </div>
                  )}
                  <button
                    onClick={() => { setAssigningWaiter(false); setAssignError(null); }}
                    className="w-full px-3 py-1.5 rounded-lg text-xs text-text-muted hover:text-text-secondary"
                  >
                    {t?.("common.cancel") || "Cancel"}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setAssigningWaiter(true); setAssignError(null); }}
                  className="w-full px-3 py-2 rounded-lg bg-ocean-100 text-ocean-700 text-xs font-bold hover:bg-ocean-200 transition active:scale-95"
                >
                  {tableSession?.waiterId
                    ? (t?.("dashboard.reassign") || "Reassign")
                    : (t?.("dashboard.assignToWaiter") || "Assign to Waiter")}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Clear Table */}
        {table.status !== "empty" && tableSession && (
          <div className="px-5 pb-3">
            <button
              onClick={async () => {
                if (!confirm((t?.("dashboard.confirm.clearTable") || `Clear Table ${table.id}? This will close the session and mark the table idle.`).replace("{id}", String(table.id)))) return;
                try {
                  await ownerFetch(ownerId ?? null, "/api/sessions", {
                    method: "PATCH",
                    body: JSON.stringify({ sessionId: tableSession.id, action: "close" }),
                  });
                } catch { /* silent */ }
                onClose();
              }}
              className="w-full p-3 rounded-xl bg-coral-50 border border-coral-200 text-coral-700 text-xs font-bold hover:bg-coral-100 transition active:scale-95"
            >
              {t?.("dashboard.clearTableEnd") || "Clear Table (End Session)"}
            </button>
          </div>
        )}

        <div className="p-5 pt-2 grid grid-cols-3 gap-2">
          <button onClick={() => { onSendWaiter(table.id); onClose(); }} className="p-3 rounded-xl bg-ocean-50 border border-ocean-200 text-ocean-700 text-xs font-bold hover:bg-ocean-100 transition active:scale-95">
            {t?.("dashboard.sendWaiter") || "Send Waiter"}
          </button>
          <button onClick={() => { activeOrder && onPrioritize(activeOrder.id); onClose(); }} disabled={!activeOrder} className="p-3 rounded-xl bg-sunset-400/10 border border-sunset-400/30 text-sand-800 text-xs font-bold hover:bg-sunset-400/20 transition disabled:opacity-30 active:scale-95">
            {t?.("dashboard.prioritize") || "Prioritize"}
          </button>
          <button onClick={() => { onPushRecommendation(table.id); onClose(); }} className="p-3 rounded-xl bg-success/5 border border-success/30 text-sand-800 text-xs font-bold hover:bg-success/10 transition active:scale-95">
            {t?.("dashboard.pushMenu") || "Push Menu"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ═════════════════════════════════════════════════
// LIVE ORDERS FEED
// ═════════════════════════════════════════════════

function LiveOrdersFeed({ orders }: { orders: LiveOrder[] }) {
  const { t } = useLanguage();
  const active = orders
    .filter((o) => !["paid"].includes(o.status))
    .sort((a, b) => {
      const priority: Record<string, number> = { ready: 0, pending: 1, preparing: 2, confirmed: 3, served: 4 };
      const pa = priority[a.status] ?? 5;
      const pb = priority[b.status] ?? 5;
      if (pa !== pb) return pa - pb;
      return b.createdAt - a.createdAt;
    });

  const statusStyle: Record<string, { dot: string; label: string; border: string }> = {
    pending: { dot: "bg-coral-400", label: t("dashboard.status.new"), border: "border-l-coral-500" },
    confirmed: { dot: "bg-ocean-400", label: t("dashboard.status.confirmed"), border: "border-l-ocean-500" },
    preparing: { dot: "bg-sunset-400", label: t("dashboard.status.cooking"), border: "border-l-sunset-400" },
    ready: { dot: "bg-success", label: t("dashboard.status.ready"), border: "border-l-success" },
    served: { dot: "bg-sand-300", label: t("dashboard.status.served"), border: "border-l-sand-300" },
  };

  return (
    <div className="card-luxury p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
          <h3 className="text-text-primary font-extrabold text-[11px] uppercase tracking-[0.2em]">
            {t("dashboard.liveOrders")}
          </h3>
        </div>
        <div className="flex gap-1.5">
          {orders.filter((o) => o.status === "pending").length > 0 && (
            <span className="px-2.5 py-1 rounded-full bg-coral-100 text-coral-700 text-[10px] font-extrabold tracking-wider animate-pulse">
              {orders.filter((o) => o.status === "pending").length} NEW
            </span>
          )}
          {orders.filter((o) => o.status === "ready").length > 0 && (
            <span className="px-2.5 py-1 rounded-full bg-success/10 text-success text-[10px] font-extrabold tracking-wider">
              {orders.filter((o) => o.status === "ready").length} READY
            </span>
          )}
        </div>
      </div>
      <div className="space-y-2 max-h-[400px] overflow-auto no-scrollbar">
        {active.slice(0, 12).map((order) => {
          const st = statusStyle[order.status] || { dot: "bg-sand-300", label: order.status, border: "border-l-sand-300" };
          const waitMin = minsAgo(order.createdAt);
          return (
            <div
              key={order.id}
              className={`flex items-center gap-3 p-3 rounded-xl bg-sand-50 border border-sand-200/60 border-l-4 ${st.border} transition-colors`}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-extrabold border-2 flex-shrink-0 ${
                order.orderType === "DELIVERY" ? "bg-status-warn-100 text-status-warn-700 border-status-warn-200" :
                order.orderType === "VIP_DINE_IN" ? "bg-status-wait-100 text-status-wait-700 border-status-wait-200" :
                "bg-white text-text-primary border-sand-200"
              }`}>{order.orderType === "DELIVERY" ? "\u{1F6F5}" : order.orderType === "VIP_DINE_IN" ? "\u{1F451}" : `T${order.tableNumber}`}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-extrabold text-text-primary tabular-nums">#{order.orderNumber}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-extrabold uppercase tracking-wider ${st.dot.replace("bg-", "bg-").replace("400", "100")} text-text-secondary`}>{st.label}</span>
                  {order.isDelayed && <span className="text-[9px] text-coral-700 font-extrabold animate-pulse uppercase tracking-wider">DELAYED</span>}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-text-muted font-medium">
                  <span className="tabular-nums">{waitMin}m</span>
                  <span>·</span>
                  <span>{order.items.length} items</span>
                  {order.vipGuestName && <><span>·</span><span className="text-ocean-600 font-bold truncate max-w-[80px]">{order.vipGuestName}</span></>}
                  {order.orderType === "DELIVERY" && order.deliveryStatus && <><span>·</span><span className="text-status-warn-600 font-bold uppercase">{order.deliveryStatus.replace("_", " ")}</span></>}
                </div>
              </div>
              <span className="text-base font-extrabold text-text-primary tabular-nums tracking-tight">{formatEGP(order.total)}</span>
            </div>
          );
        })}
        {active.length === 0 && (
          <p className="text-center text-text-muted text-sm py-6">{t("dashboard.noActiveOrders")}</p>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════
// VIP & DELIVERY ACTIVITY
// ═════════════════════════════════════════════════

function VipDeliveryActivity({ orders, sessions }: { orders: LiveOrder[]; sessions: { id: string; tableNumber: number | null; status: string; orderType?: string; vipGuestName?: string | null; waiterName?: string; orderTotal?: number; openedAt?: string }[] }) {
  const { t } = useLanguage();
  const vipOrders = orders.filter((o) => o.orderType === "VIP_DINE_IN" || o.orderType === "DELIVERY");
  const deliveryOrders = orders.filter((o) => o.orderType === "DELIVERY" && o.status !== "paid" && o.status !== "cancelled");
  const vipDineIn = orders.filter((o) => o.orderType === "VIP_DINE_IN" && o.status !== "paid" && o.status !== "cancelled");
  const vipSessions = sessions.filter((s) => s.status === "OPEN" && (s.orderType === "VIP_DINE_IN" || s.orderType === "DELIVERY"));

  const deliveryByStatus: Record<string, typeof deliveryOrders> = {};
  for (const o of deliveryOrders) {
    const key = o.deliveryStatus || o.status;
    (deliveryByStatus[key] ||= []).push(o);
  }

  const pipelineSteps = [
    { key: "pending", labelKey: "dashboard.delivery.pending", color: "bg-coral-400" },
    { key: "confirmed", labelKey: "dashboard.delivery.confirmed", color: "bg-ocean-400" },
    { key: "preparing", labelKey: "dashboard.delivery.preparing", color: "bg-sunset-400" },
    { key: "ready", labelKey: "dashboard.delivery.ready", color: "bg-success" },
    { key: "ASSIGNED", labelKey: "dashboard.delivery.assigned", color: "bg-status-info-400" },
    { key: "PICKED_UP", labelKey: "dashboard.delivery.pickedUp", color: "bg-ocean-400" },
    { key: "ON_THE_WAY", labelKey: "dashboard.delivery.onTheWay", color: "bg-status-warn-500" },
  ];

  return (
    <div className="card-luxury p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-text-primary font-extrabold text-[11px] uppercase tracking-[0.2em]">
          {t("dashboard.vipDeliveryTitle")}
        </h3>
        {(vipOrders.length > 0 || vipSessions.length > 0) && (
          <span className="px-2.5 py-1 rounded-full bg-status-warn-100 text-status-warn-700 text-[10px] font-extrabold tracking-wider uppercase">{vipSessions.length} {t("dashboard.active")}</span>
        )}
      </div>
      {vipOrders.length === 0 && vipSessions.length === 0 && (
        <p className="text-text-muted text-xs">{t("dashboard.noVipActivity")}</p>
      )}

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="rounded-xl bg-status-wait-50 border border-status-wait-200 p-3 text-center">
          <div className="text-[9px] font-extrabold text-status-wait-500 uppercase tracking-widest mb-1">{t("dashboard.dineIn")}</div>
          <div className="text-2xl font-extrabold text-status-wait-700 tabular-nums leading-none">{vipDineIn.length}</div>
        </div>
        <div className="rounded-xl bg-status-warn-50 border border-status-warn-200 p-3 text-center">
          <div className="text-[9px] font-extrabold text-status-warn-500 uppercase tracking-widest mb-1">{t("dashboard.deliveries")}</div>
          <div className="text-2xl font-extrabold text-status-warn-700 tabular-nums leading-none">{deliveryOrders.length}</div>
        </div>
        <div className="rounded-xl bg-status-good-50 border border-status-good-200 p-3 text-center">
          <div className="text-[9px] font-extrabold text-status-good-500 uppercase tracking-widest mb-1">{t("dashboard.vipRevenue")}</div>
          <div className="text-xl font-extrabold text-status-good-700 tabular-nums leading-none tracking-tight">{formatEGP(vipOrders.reduce((s, o) => s + o.total, 0))}</div>
        </div>
      </div>

      {/* Delivery pipeline */}
      {deliveryOrders.length > 0 && (
        <div className="mb-4">
          <p className="text-[10px] font-extrabold text-text-muted uppercase tracking-widest mb-2">{t("dashboard.deliveryPipeline")}</p>
          <div className="flex gap-1.5 flex-wrap">
            {pipelineSteps.map((step) => {
              const count = deliveryByStatus[step.key]?.length || 0;
              if (count === 0) return null;
              return (
                <span key={step.key} className={`px-2.5 py-1 rounded-lg text-white text-[10px] font-extrabold uppercase tracking-wider ${step.color}`}>
                  {count} {t(step.labelKey)}
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Active VIP sessions list */}
      <div className="space-y-2 max-h-[220px] overflow-auto no-scrollbar">
        {vipSessions.map((s) => {
          const isDelivery = s.orderType === "DELIVERY";
          const sessionOrders = orders.filter((o) => (o.orderType === s.orderType) && o.vipGuestName === s.vipGuestName && o.status !== "paid" && o.status !== "cancelled");
          const latestStatus = sessionOrders[0]?.status || "—";
          const deliverySt = sessionOrders[0]?.deliveryStatus;
          return (
            <div key={s.id} className={`flex items-center gap-3 p-3 rounded-xl border-2 ${isDelivery ? "bg-status-warn-50/50 border-status-warn-200" : "bg-status-wait-50/50 border-status-wait-200"}`}>
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-base text-white flex-shrink-0 ${isDelivery ? "bg-status-warn-500" : "bg-status-wait-600"}`}>
                {isDelivery ? "\u{1F6F5}" : "\u{1F451}"}
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-extrabold text-text-primary truncate block">{s.vipGuestName || "VIP Guest"}</span>
                <span className="text-[10px] text-text-muted font-medium">{isDelivery ? "Delivery" : "Dine-in"} · {deliverySt ? deliverySt.replace("_", " ") : latestStatus}{s.waiterName ? ` · ${s.waiterName}` : ""}</span>
              </div>
              {s.orderTotal != null && s.orderTotal > 0 && (
                <span className="text-base font-extrabold text-text-primary tabular-nums tracking-tight">{formatEGP(s.orderTotal)}</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════
// AI BRAIN
// ═════════════════════════════════════════════════

function AIBrain({
  insights,
  decisions,
  onAcceptInsight,
  onDismissInsight,
  onRevertDecision,
}: {
  insights: Insight[];
  decisions: DecisionRecord[];
  onAcceptInsight: (insight: Insight) => void;
  onDismissInsight: (id: string) => void;
  onRevertDecision: (id: string) => void;
}) {
  const { t } = useLanguage();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const sys = useSystemState();
  const visibleInsights = insights.filter((i) => !dismissed.has(i.id));

  const activeDecisions = decisions
    .filter((d) => !d.reverted && !d.disabledByOwner)
    .slice(-8)
    .reverse();

  const impactedDecisions = decisions.filter((d) => d.impact && !d.reverted);
  const positiveImpact = impactedDecisions.filter((d) => d.impact?.improved).length;
  const totalImpact = impactedDecisions.length;

  const severityStyle = {
    critical: { border: "border-l-coral-500", bg: "bg-coral-50", color: "text-coral-600" },
    warning: { border: "border-l-sunset-400", bg: "bg-sunset-400/10", color: "text-sunset-500" },
    opportunity: { border: "border-l-success", bg: "bg-success/5", color: "text-success" },
    info: { border: "border-l-ocean-400", bg: "bg-ocean-50", color: "text-ocean-600" },
  };

  const MODE_INFO = {
    aggressive: { label: t("dashboard.mode.aggressive"), desc: t("dashboard.mode.aggressiveDesc"), color: "text-coral-600", activeBg: "bg-coral-50 border-coral-200 text-coral-700" },
    balanced: { label: t("dashboard.mode.balanced"), desc: t("dashboard.mode.balancedDesc"), color: "text-sunset-500", activeBg: "bg-sunset-400/10 border-sunset-400/30 text-sand-800" },
    safe: { label: t("dashboard.mode.safe"), desc: t("dashboard.mode.safeDesc"), color: "text-success", activeBg: "bg-success/10 border-success/30 text-sand-800" },
  };

  const stateColors = {
    traffic: { low: "text-text-muted", normal: "text-success", high: "text-sunset-500", peak: "text-coral-600" },
    kitchen: { light: "text-text-muted", normal: "text-success", heavy: "text-sunset-500", critical: "text-coral-600" },
    behavior: { exploring: "text-text-muted", buying: "text-success", hesitating: "text-sunset-500", abandoning: "text-coral-600" },
  };

  const modeInfo = MODE_INFO[sys.systemMode];

  return (
    <div className="card-luxury p-5">
      {/* Header — title hierarchy makes the live indicator + impact stats glanceable */}
      <div className="mb-5">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <span className="inline-flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-[0.18em] text-status-wait-700">
            <span className="w-1.5 h-1.5 rounded-full bg-status-wait-500 animate-pulse" />
            {t("dashboard.live")}
          </span>
          {totalImpact > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-[0.18em] text-success">
              <span>↑</span> {positiveImpact}/{totalImpact} {t("dashboard.improved")}
            </span>
          )}
        </div>
        <h3 className="text-text-primary font-extrabold text-2xl leading-tight">
          {t("dashboard.aiBrainTitle")}
        </h3>
        <p className="text-text-muted text-xs mt-1.5">
          {visibleInsights.length} {t("dashboard.recommendations")} · {activeDecisions.length} {t("dashboard.active")}
        </p>
      </div>

      {/* System state — three big chips that summarize the cafe in one glance */}
      <div className="grid grid-cols-3 gap-2 mb-5">
        <div className="bg-sand-50 rounded-xl px-3 py-3 border border-sand-200/60">
          <div className="text-[9px] text-text-muted font-extrabold uppercase tracking-widest mb-1">{t("dashboard.traffic")}</div>
          <div className={`text-base font-extrabold uppercase tracking-tight leading-none ${stateColors.traffic[sys.trafficLevel]}`}>{sys.trafficLevel}</div>
        </div>
        <div className="bg-sand-50 rounded-xl px-3 py-3 border border-sand-200/60">
          <div className="text-[9px] text-text-muted font-extrabold uppercase tracking-widest mb-1">{t("dashboard.header.kitchen")}</div>
          <div className={`text-base font-extrabold uppercase tracking-tight leading-none ${stateColors.kitchen[sys.kitchenLoad]}`}>{sys.kitchenLoad}</div>
        </div>
        <div className="bg-sand-50 rounded-xl px-3 py-3 border border-sand-200/60">
          <div className="text-[9px] text-text-muted font-extrabold uppercase tracking-widest mb-1">{t("dashboard.customers")}</div>
          <div className={`text-base font-extrabold uppercase tracking-tight leading-none ${stateColors.behavior[sys.customerBehavior]}`}>{sys.customerBehavior}</div>
        </div>
      </div>

      {/* AI Mode */}
      <div className="mb-4 bg-sand-50 rounded-xl p-3 border border-sand-200/60">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-text-secondary">{t("dashboard.brainMode")}</p>
          <span className={`text-[10px] font-bold ${modeInfo.color}`}>{modeInfo.label}</span>
        </div>
        <div className="flex gap-1 mb-1.5">
          {(["safe", "balanced", "aggressive"] as const).map((mode) => {
            const ml = MODE_INFO[mode];
            return (
              <button
                key={mode}
                onClick={() => sys.setSystemMode(mode)}
                className={`flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all border ${
                  sys.systemMode === mode ? ml.activeBg : "bg-white text-text-muted border-sand-200"
                }`}
              >
                {mode}
              </button>
            );
          })}
        </div>
        <p className="text-[10px] text-text-muted">{modeInfo.desc}</p>
      </div>

      {/* Recommendations */}
      {visibleInsights.length > 0 && (
        <div className="mb-4">
          <p className="text-[10px] text-text-muted font-semibold uppercase tracking-wider mb-2">{t("dashboard.recommendations")}</p>
          <div className="space-y-2 max-h-[300px] overflow-y-auto no-scrollbar">
            <AnimatePresence mode="popLayout">
              {visibleInsights.slice(0, 5).map((insight) => {
                const style = severityStyle[insight.severity];
                return (
                  <motion.div
                    key={insight.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className={`p-3.5 rounded-xl ${style.bg} border-l-[3px] ${style.border} border border-sand-200/40`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className={`w-5 h-5 rounded-full bg-white flex items-center justify-center text-[10px] font-bold ${style.color} flex-shrink-0 mt-0.5 shadow-sm`}>
                        !
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-text-primary">{insight.title}</p>
                        <p className="text-xs text-text-secondary mt-0.5 line-clamp-2">{insight.description}</p>
                        {insight.metric && (
                          <div className="flex items-center gap-2 mt-1.5">
                            <span className="text-sm font-bold text-text-primary tabular-nums">{insight.metric.value.toFixed(1)}</span>
                            <span className="text-[10px] text-text-muted">{insight.metric.unit}</span>
                            <span className={`text-xs font-bold ${insight.metric.trend === "up" ? "text-success" : insight.metric.trend === "down" ? "text-coral-600" : "text-text-muted"}`}>
                              {insight.metric.trend === "up" ? "↑" : insight.metric.trend === "down" ? "↓" : "→"}
                            </span>
                          </div>
                        )}
                        <div className="flex gap-2 mt-2">
                          {insight.action && (
                            <button
                              onClick={() => onAcceptInsight(insight)}
                              className="btn-primary !px-3 !py-1.5 !text-[10px] !rounded-lg"
                            >
                              {insight.action.label}
                            </button>
                          )}
                          <button
                            onClick={() => { setDismissed((s) => new Set([...s, insight.id])); onDismissInsight(insight.id); }}
                            className="px-3 py-1.5 rounded-lg text-text-muted text-[10px] font-bold hover:text-text-secondary transition"
                          >
                            {t("dashboard.dismiss")}
                          </button>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </div>
      )}

      {visibleInsights.length === 0 && (
        <div className="mb-4 text-center py-4 bg-sand-50 rounded-xl border border-sand-200/60">
          <p className="text-text-muted text-sm">{t("dashboard.monitoring")}</p>
        </div>
      )}

      {/* Active Decisions */}
      {activeDecisions.length > 0 && (
        <div>
          <p className="text-[10px] text-text-muted font-semibold uppercase tracking-wider mb-2">{t("dashboard.brainActivity")}</p>
          <div className="space-y-1.5 max-h-[200px] overflow-y-auto no-scrollbar">
            {activeDecisions.map((dec) => {
              const priorityColor = {
                critical: "border-l-coral-500 bg-coral-50",
                high: "border-l-sunset-400 bg-sunset-400/5",
                medium: "border-l-ocean-400 bg-ocean-50",
                low: "border-l-sand-300 bg-sand-50",
              }[dec.priority];

              return (
                <div key={dec.id} className={`p-2.5 rounded-xl border border-sand-200/40 border-l-[3px] ${priorityColor}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] font-semibold text-text-secondary">{dec.trigger}</p>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {dec.actions.slice(0, 2).map((a, i) => (
                          <span key={i} className="text-[9px] text-text-muted">{a.description}</span>
                        ))}
                      </div>
                      {dec.impact && (
                        <div className={`mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${
                          dec.impact.improved ? "bg-success/10 text-success" : "bg-coral-50 text-coral-600"
                        }`}>
                          {dec.impact.improved ? "↑" : "↓"} {dec.impact.delta >= 0 ? "+" : ""}{dec.impact.delta.toFixed(1)} {dec.evaluationMetric.replace(/_/g, " ")}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => onRevertDecision(dec.id)}
                      className="px-2 py-1 rounded-lg text-[9px] font-bold text-text-muted hover:text-coral-600 bg-white border border-sand-200 transition flex-shrink-0"
                    >
                      {t("dashboard.revert")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════
// QUICK CONTROLS
// ═════════════════════════════════════════════════

function QuickControls({
  onBoostItem,
  onActivatePromo,
  activePromotions,
}: {
  onBoostItem: (itemId: string, reason: string) => void;
  onActivatePromo: (promo: ActivePromotion) => void;
  activePromotions: ActivePromotion[];
}) {
  const { t } = useLanguage();
  const [flashId, setFlashId] = useState<string | null>(null);
  const flash = (id: string) => { setFlashId(id); setTimeout(() => setFlashId(null), 2000); };

  const actions = [
    {
      id: "happy", icon: "🍹", label: t("dashboard.promo.happyHour"), desc: t("dashboard.promo.happyHourDesc"),
      bg: "bg-ocean-50 hover:bg-ocean-100", border: "border-ocean-200",
      action: () => {
        onActivatePromo({ id: "happy-hour", type: "happy_hour", title: "Happy Hour", subtitle: "Selected drinks at special prices", badge: "Happy Hour", itemIds: useMenu.getState().allItems.filter((i) => i.tags.includes("drink")).map((i) => i.id), discountPercent: 20, active: true });
        flash("happy");
      },
    },
    {
      id: "sunset", icon: "🌅", label: t("dashboard.promo.sunsetMode"), desc: t("dashboard.promo.sunsetModeDesc"),
      bg: "bg-sunset-400/10 hover:bg-sunset-400/20", border: "border-sunset-400/30",
      action: () => {
        onActivatePromo({ id: "sunset-promo", type: "sunset", title: "Golden Hour Specials", subtitle: "Premium cocktails at their best", badge: "Sunset", itemIds: useMenu.getState().allItems.filter((i) => i.tags.includes("cocktail") || i.tags.includes("premium-drink")).map((i) => i.id), active: true });
        flash("sunset");
      },
    },
    {
      id: "bestseller", icon: "⭐", label: t("dashboard.promo.pushBestSellers"), desc: t("dashboard.promo.pushBestSellersDesc"),
      bg: "bg-sand-100 hover:bg-sand-200", border: "border-sand-300",
      action: () => { useMenu.getState().allItems.filter((i) => i.bestSeller).forEach((i) => onBoostItem(i.id, "Owner push")); flash("bestseller"); },
    },
    {
      id: "premium", icon: "💎", label: t("dashboard.promo.premiumPush"), desc: t("dashboard.promo.premiumPushDesc"),
      bg: "bg-status-wait-50 hover:bg-status-wait-100", border: "border-status-wait-200",
      action: () => { useMenu.getState().allItems.filter((i) => i.highMargin && i.price > 150).forEach((i) => onBoostItem(i.id, "Premium push")); flash("premium"); },
    },
    {
      id: "flash-deal", icon: "⚡", label: t("dashboard.promo.flashDeal"), desc: t("dashboard.promo.flashDealDesc"),
      bg: "bg-success/5 hover:bg-success/10", border: "border-success/30",
      action: () => {
        onActivatePromo({ id: "flash-deal", type: "flash", title: "Flash Deal — 15 Min Only", subtitle: "Limited time prices", badge: "Flash", itemIds: useMenu.getState().allItems.filter((i) => i.bestSeller).slice(0, 3).map((i) => i.id), discountPercent: 15, expiresAt: Date.now() + 15 * 60000, active: true });
        flash("flash-deal");
      },
    },
    {
      id: "fast-track", icon: "🚀", label: t("dashboard.promo.kitchenFastTrack"), desc: t("dashboard.promo.kitchenFastTrackDesc"),
      bg: "bg-coral-50 hover:bg-coral-100", border: "border-coral-200",
      action: () => { useMenu.getState().allItems.filter((i) => (i.prepTime || 0) <= 8).forEach((i) => onBoostItem(i.id, "Fast-track")); flash("fast-track"); },
    },
  ];

  return (
    <div className="card-luxury p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-text-primary font-extrabold text-[11px] uppercase tracking-[0.2em]">{t("dashboard.quickControls")}</h3>
          <p className="text-text-muted text-[11px] mt-1 font-medium">{t("dashboard.instantActions")}</p>
        </div>
        {activePromotions.filter((p) => p.active).length > 0 && (
          <span className="px-2.5 py-1 rounded-full bg-success/10 text-success text-[10px] font-extrabold tracking-wider uppercase">
            {activePromotions.filter((p) => p.active).length} Live
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        {actions.map((a) => (
          <motion.button
            key={a.id}
            onClick={a.action}
            className={`relative p-3 rounded-xl ${a.bg} border-2 ${a.border} text-left transition-all min-h-[88px]`}
            whileTap={{ scale: 0.96 }}
          >
            <span className="text-2xl block mb-1.5">{a.icon}</span>
            <span className="text-[11px] font-extrabold text-text-primary block leading-tight">{a.label}</span>
            <span className="text-[9px] text-text-muted block leading-tight mt-0.5">{a.desc}</span>
            <AnimatePresence>
              {flashId === a.id && (
                <motion.div className="absolute top-2 right-2 w-5 h-5 rounded-full bg-success flex items-center justify-center" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                  <span className="text-white text-[10px] font-bold">✓</span>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.button>
        ))}
      </div>

      {activePromotions.filter((p) => p.active).length > 0 && (
        <div className="space-y-1.5">
          {activePromotions.filter((p) => p.active).map((promo) => (
            <div key={promo.id} className="flex items-center justify-between p-3 rounded-xl bg-success/5 border-2 border-success/20">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-extrabold text-text-secondary uppercase tracking-wider truncate">{promo.badge}</span>
                <span className="text-xs text-text-muted truncate">{promo.title}</span>
              </div>
              <span className="px-2 py-0.5 rounded bg-success/10 text-success text-[10px] font-extrabold tracking-wider uppercase flex-shrink-0">Live</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════
// MENU PERFORMANCE
// ═════════════════════════════════════════════════

function MenuPerformance({
  leaks,
  onBoost,
  onDiscount,
  onHide,
}: {
  leaks: ItemPerformance[];
  onBoost: (itemId: string) => void;
  onDiscount: (itemId: string) => void;
  onHide: (itemId: string) => void;
}) {
  const { t } = useLanguage();
  const itemViews = usePerception((s) => s.itemViews);
  const orders = usePerception((s) => s.orders);
  const perf = analyzeItemPerformance(itemViews, orders);

  const estimatedLoss = leaks.reduce((sum, leak) => {
    const item = useMenu.getState().allItems.find((i) => i.id === leak.itemId);
    if (!item) return sum;
    const missedOrders = Math.round(leak.views * 0.2) - leak.orders;
    return sum + Math.max(0, missedOrders) * item.price;
  }, 0);

  return (
    <div className="card-luxury p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-text-primary font-extrabold text-[11px] uppercase tracking-[0.2em]">{t("dashboard.menuPerformanceTitle")}</h3>
          <p className="text-text-muted text-[11px] mt-1 font-medium">{t("dashboard.menuPerformanceDesc")}</p>
        </div>
        {estimatedLoss > 0 && (
          <div className="text-right flex-shrink-0">
            <div className="text-[9px] font-extrabold text-coral-600 uppercase tracking-widest">{t("dashboard.leaking")}</div>
            <div className="text-xl font-extrabold text-coral-600 tabular-nums tracking-tight leading-none mt-0.5">~{formatEGP(estimatedLoss)}</div>
          </div>
        )}
      </div>

      <div className="space-y-2 max-h-[400px] overflow-y-auto no-scrollbar">
        {perf.slice(0, 10).map((item) => {
          const menuItem = useMenu.getState().allItems.find((i) => i.id === item.itemId);
          const isLeak = item.trend === "leaking";
          const isHot = item.trend === "hot";

          return (
            <div
              key={item.itemId}
              className={`flex items-center gap-3 p-3 rounded-xl border-2 ${
                isLeak ? "bg-coral-50/50 border-coral-200" : isHot ? "bg-success/5 border-success/20" : "bg-sand-50 border-sand-200/60"
              }`}
            >
              <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-sand-100 border border-sand-200">
                <div className="w-full h-full bg-cover bg-center" style={{ backgroundImage: `url(${resolveImage(menuItem?.image)})` }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="text-sm font-extrabold text-text-primary truncate">{item.name}</p>
                  {isLeak && <span className="px-1.5 py-0.5 rounded bg-coral-100 text-coral-700 text-[9px] font-extrabold tracking-wider flex-shrink-0">LEAK</span>}
                  {isHot && <span className="px-1.5 py-0.5 rounded bg-success/10 text-success text-[9px] font-extrabold tracking-wider flex-shrink-0">HOT</span>}
                </div>
                <p className="text-[11px] text-text-muted font-medium tabular-nums">
                  {item.views}v → {item.orders}o · <span className={`font-extrabold ${isLeak ? "text-coral-600" : "text-text-secondary"}`}>{(item.conversionRate * 100).toFixed(0)}%</span>
                </p>
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button onClick={() => onBoost(item.itemId)} className="px-2.5 py-1.5 rounded-lg bg-ocean-50 border border-ocean-200 text-ocean-700 text-[10px] font-extrabold uppercase tracking-wider hover:bg-ocean-100 transition active:scale-95">{t("dashboard.boost")}</button>
                <button onClick={() => onDiscount(item.itemId)} className="px-2.5 py-1.5 rounded-lg bg-sunset-400/10 border border-sunset-400/20 text-sand-800 text-[10px] font-extrabold uppercase tracking-wider hover:bg-sunset-400/20 transition active:scale-95">{t("dashboard.deal")}</button>
                <button onClick={() => onHide(item.itemId)} className="px-2.5 py-1.5 rounded-lg bg-sand-100 border border-sand-200 text-text-muted text-[10px] font-extrabold uppercase tracking-wider hover:text-text-secondary transition active:scale-95">{t("dashboard.hide")}</button>
              </div>
            </div>
          );
        })}
        {perf.length === 0 && (
          <p className="text-center text-text-muted text-sm py-6">{t("dashboard.waitingForData")}</p>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════
// VOICE NOTE
// ═════════════════════════════════════════════════

function VoiceNoteBubble({ staff, restaurantSlug, ownerId }: { staff: StaffMember[]; restaurantSlug: string; ownerId: string | null }) {
  const { t } = useLanguage();
  type VNState = "idle" | "selecting" | "recording" | "recorded" | "sending" | "sent";
  const [vnState, setVnState] = useState<VNState>("idle");
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [selectedName, setSelectedName] = useState("");
  const [hoveredTarget, setHoveredTarget] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<string | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  const waiters = staff.filter((s) => s.role === "WAITER" && s.active);
  const kitchenStaff = staff.filter((s) => s.role === "KITCHEN" && s.active);

  // Build targets array: All, Kitchen, then individual waiters
  const targets = [
    { id: "all", name: t("dashboard.broadcastAll"), icon: "📢", color: "bg-ocean-500" },
    ...(kitchenStaff.length > 0 ? [{ id: "kitchen", name: t("dashboard.broadcastKitchen"), icon: "🔥", color: "bg-status-warn-500" }] : []),
    ...waiters.map((w) => ({ id: w.id, name: w.name, icon: w.name.charAt(0).toUpperCase(), color: "bg-ocean-500" })),
  ];

  const handleBubblePress = () => {
    if (vnState === "idle") {
      setVnState("selecting");
    } else if (vnState === "recording") {
      // Stop recording
      mediaRecorderRef.current?.stop();
      setVnState("recorded");
    } else if (vnState === "recorded") {
      // Send
      sendVoiceNote();
    }
  };

  const handleTargetSelect = async (targetId: string, targetName: string) => {
    setSelectedTarget(targetId);
    setSelectedName(targetName);
    setHoveredTarget(null);
    // Start recording immediately after target selection
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm;codecs=opus" });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];
      mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      mediaRecorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onloadend = () => { audioRef.current = reader.result as string; };
        reader.readAsDataURL(blob);
      };
      mediaRecorder.start();
      setVnState("recording");
    } catch (err) {
      console.error("Microphone access denied:", err);
      setVnState("idle");
    }
  };

  const sendVoiceNote = async () => {
    if (!audioRef.current || !selectedTarget) return;
    setVnState("sending");
    try {
      await ownerFetch(ownerId, "/api/messages", {
        method: "POST",
        body: JSON.stringify({
          type: "voice", from: "owner", to: selectedTarget,
          audio: audioRef.current, text: "Voice note from owner",
          restaurantId: restaurantSlug,
        }),
      });
      setVnState("sent");
      setTimeout(() => { setVnState("idle"); setSelectedTarget(null); audioRef.current = null; }, 2000);
    } catch {
      setVnState("idle");
    }
  };

  const cancelVN = () => {
    if (vnState === "recording") {
      mediaRecorderRef.current?.stop();
    }
    setVnState("idle");
    setSelectedTarget(null);
    audioRef.current = null;
  };

  // Stack targets in a vertical column directly above the bubble.
  // A semi-circle layout pushed right-side icons off-screen on mobile
  // because the bubble sits at right-6, so a horizontal spread had
  // nowhere to go. Vertical stacking always has room regardless of
  // how many targets exist. Top-most target is the last in the list,
  // so the first item sits closest to the bubble.
  const TARGET_STEP = 64; // px between stacked icons
  const TARGET_OFFSET = 70; // px above the bubble for the first icon
  const getTargetPosition = (index: number) => ({
    x: 0,
    y: -(TARGET_OFFSET + index * TARGET_STEP),
  });

  const bubbleColor = vnState === "recording" ? "bg-status-bad-500" : vnState === "recorded" ? "bg-status-good-500" : vnState === "sending" ? "bg-status-warn-500" : vnState === "sent" ? "bg-status-good-500" : "bg-ocean-600";

  // Distinct glyph per state — recording uses a crisp SVG stop square
  // (not the Unicode "⏹", which is too faint and looks like a disabled
  // pause on many phones) to make it obvious you tap to stop.
  const renderBubbleIcon = () => {
    if (vnState === "recording") {
      return (
        <span className="relative flex items-center justify-center">
          <svg className="w-5 h-5 lg:w-6 lg:h-6" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="6" width="12" height="12" rx="2" />
          </svg>
        </span>
      );
    }
    if (vnState === "recorded") return <span>➤</span>;
    if (vnState === "sending") return <span>...</span>;
    if (vnState === "sent") return <span>✓</span>;
    return <span>🎤</span>;
  };

  return (
    <div className="fixed bottom-20 right-6 lg:bottom-24 lg:right-auto lg:left-1/2 lg:-translate-x-1/2 z-50 overflow-visible" ref={bubbleRef}>
      {/* Target icons — appear in semi-circle when selecting */}
      <AnimatePresence>
        {vnState === "selecting" && targets.map((t, i) => {
          const pos = getTargetPosition(i);
          const isHovered = hoveredTarget === t.id;
          return (
            <motion.button
              key={t.id}
              initial={{ scale: 0, x: 0, y: 0, opacity: 0 }}
              animate={{ scale: isHovered ? 1.2 : 1, x: pos.x, y: pos.y, opacity: 1 }}
              exit={{ scale: 0, x: 0, y: 0, opacity: 0 }}
              transition={{ type: "spring", damping: 15, stiffness: 200, delay: i * 0.05 }}
              className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-14 h-14 rounded-full ${t.color} text-white flex flex-col items-center justify-center shadow-lg border-2 ${isHovered ? "border-white" : "border-white/30"}`}
              onPointerEnter={() => setHoveredTarget(t.id)}
              onPointerLeave={() => setHoveredTarget(null)}
              onClick={() => handleTargetSelect(t.id, t.name)}
            >
              <span className="text-lg leading-none">{t.icon.length <= 2 && /\p{Emoji}/u.test(t.icon) ? t.icon : ""}</span>
              {!/\p{Emoji}/u.test(t.icon) && <span className="text-base font-semibold leading-none">{t.icon}</span>}
              <span className="text-[8px] font-bold mt-0.5 leading-none truncate max-w-[48px]">{t.name}</span>
            </motion.button>
          );
        })}
      </AnimatePresence>

      {/* Recording status label */}
      <AnimatePresence>
        {vnState === "recording" && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: -60 }}
            exit={{ opacity: 0 }}
            className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap"
          >
            <div className="px-3 py-1.5 rounded-full bg-status-bad-500 text-white text-xs font-bold flex items-center gap-2 shadow-lg">
              <motion.div className="w-2 h-2 rounded-full bg-white" animate={{ opacity: [1, 0.3, 1] }} transition={{ repeat: Infinity, duration: 1 }} />
              {t("dashboard.recording")}
            </div>
          </motion.div>
        )}
        {vnState === "recorded" && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: -60 }}
            exit={{ opacity: 0 }}
            className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap"
          >
            <div className="px-3 py-1.5 rounded-full bg-status-good-500 text-white text-xs font-bold shadow-lg">
              {t("dashboard.tapToSendTo").replace("{name}", selectedName)}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cancel button — positioned top-right of the bubble */}
      <AnimatePresence>
        {(vnState === "recording" || vnState === "recorded" || vnState === "selecting") && (
          <motion.button
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            onClick={cancelVN}
            className="absolute -top-2 -right-2 w-7 h-7 rounded-full bg-sand-900/90 backdrop-blur-sm text-white/80 flex items-center justify-center text-xs shadow-lg border border-white/20 z-10"
          >✕</motion.button>
        )}
      </AnimatePresence>

      {/* Main bubble */}
      <motion.button
        onClick={handleBubblePress}
        className={`relative w-14 h-14 lg:w-16 lg:h-16 rounded-full ${bubbleColor} text-white flex items-center justify-center text-xl lg:text-2xl shadow-[0_4px_20px_rgba(0,0,0,0.25)] border-2 border-white/20 backdrop-blur-sm`}
        whileTap={{ scale: 0.9 }}
        animate={vnState === "recording" ? { scale: [1, 1.1, 1], boxShadow: ["0 0 0 0 rgba(239,68,68,0.4)", "0 0 0 12px rgba(239,68,68,0)", "0 0 0 0 rgba(239,68,68,0.4)"] } : {}}
        transition={vnState === "recording" ? { repeat: Infinity, duration: 1.5 } : {}}
      >
        {renderBubbleIcon()}
      </motion.button>
    </div>
  );
}

// ═════════════════════════════════════════════════
// STAFF MANAGEMENT
// ═════════════════════════════════════════════════

function ownerFetch(ownerId: string | null, url: string, init?: RequestInit) {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (ownerId) headers.set("x-staff-id", ownerId);
  return fetch(url, { ...init, headers });
}

function StaffPanel({ staff, onRefresh, restaurantId, restaurantSlug, ownerId }: { staff: StaffMember[]; onRefresh: () => void; restaurantId: string; restaurantSlug: string; ownerId: string | null }) {
  const { t } = useLanguage();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [role, setRole] = useState<"WAITER" | "KITCHEN" | "BAR" | "CASHIER" | "FLOOR_MANAGER" | "DELIVERY">("WAITER");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [endingShift, setEndingShift] = useState<string | null>(null);
  const [shiftResult, setShiftResult] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [resettingId, setResettingId] = useState<string | null>(null);
  const [resetPin, setResetPin] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const showPins = false; // PINs are hashed — cannot be revealed
  const [waiterCapacity, setWaiterCapacity] = useState(15);
  const [instapayHandle, setInstapayHandle] = useState("");
  const [instapayPhone, setInstapayPhone] = useState("");
  const [instapaySaveState, setInstapaySaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  // Service-model toggle (WAITER ↔ RUNNER) + the auto-applied service
  // charge percent. Switching is instant: server cache invalidates,
  // login routes pick up the new value, all gating flips. Reverse is
  // identical — owner taps WAITER again and the legacy flow resumes.
  const [serviceModel, setServiceModel] = useState<"WAITER" | "RUNNER">("WAITER");
  const [serviceChargePct, setServiceChargePct] = useState<string>("");
  const [serviceModelSaveState, setServiceModelSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    fetch(`/api/restaurant?slug=${restaurantSlug}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.waiterCapacity) setWaiterCapacity(d.waiterCapacity);
        if (typeof d.instapayHandle === "string") setInstapayHandle(d.instapayHandle);
        if (typeof d.instapayPhone === "string") setInstapayPhone(d.instapayPhone);
        if (d.serviceModel === "WAITER" || d.serviceModel === "RUNNER") setServiceModel(d.serviceModel);
        if (typeof d.serviceChargePercent === "number") setServiceChargePct(String(d.serviceChargePercent));
      })
      .catch(() => {});
  }, [restaurantSlug]);

  const saveServiceModel = async (nextModel: "WAITER" | "RUNNER", nextPct: string) => {
    setServiceModelSaveState("saving");
    try {
      const pct = parseFloat(nextPct);
      const res = await ownerFetch(ownerId, "/api/restaurant", {
        method: "PATCH",
        body: JSON.stringify({
          slug: restaurantSlug,
          serviceModel: nextModel,
          // Only send pct if it parses to a sane value, otherwise
          // leave the column unchanged.
          ...(isFinite(pct) && pct >= 0 && pct <= 100 ? { serviceChargePercent: pct } : {}),
        }),
      });
      if (!res.ok) throw new Error("save failed");
      setServiceModel(nextModel);
      setServiceModelSaveState("saved");
      setTimeout(() => setServiceModelSaveState("idle"), 2000);
    } catch {
      setServiceModelSaveState("error");
      setTimeout(() => setServiceModelSaveState("idle"), 3000);
    }
  };

  const updateWaiterCapacity = (next: number) => {
    const clamped = Math.max(1, Math.min(99, next));
    setWaiterCapacity(clamped);
    ownerFetch(ownerId, "/api/restaurant", {
      method: "PATCH",
      body: JSON.stringify({ slug: restaurantSlug, waiterCapacity: clamped }),
    }).catch(() => {});
  };

  const saveInstapay = async () => {
    setInstapaySaveState("saving");
    try {
      const res = await ownerFetch(ownerId, "/api/restaurant", {
        method: "PATCH",
        body: JSON.stringify({
          slug: restaurantSlug,
          instapayHandle: instapayHandle.trim(),
          instapayPhone: instapayPhone.trim(),
        }),
      });
      if (!res.ok) throw new Error("save failed");
      setInstapaySaveState("saved");
      setTimeout(() => setInstapaySaveState("idle"), 2000);
    } catch {
      setInstapaySaveState("error");
      setTimeout(() => setInstapaySaveState("idle"), 3000);
    }
  };

  const handleDelete = async (staffId: string) => {
    setDeleting(staffId);
    setDeleteError(null);
    try {
      const res = await ownerFetch(ownerId, "/api/staff", {
        method: "DELETE",
        body: JSON.stringify({ id: staffId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setDeleteError(data.error || t("dashboard.failedToDelete"));
        setTimeout(() => setDeleteError(null), 6000);
      } else {
        onRefresh();
      }
    } catch { setDeleteError(t("dashboard.networkError")); }
    setDeleting(null);
    setConfirmDelete(null);
  };

  const handleCreate = async () => {
    if (!name.trim()) { setError(t("dashboard.nameRequired")); return; }
    if (pin.length < 4 || pin.length > 6 || !/^\d+$/.test(pin)) { setError(t("dashboard.pinMustBe")); return; }
    setError(""); setLoading(true);
    try {
      const res = await ownerFetch(ownerId, "/api/staff", { method: "POST", body: JSON.stringify({ name: name.trim(), pin, role, restaurantId }) });
      if (!res.ok) { const data = await res.json(); setError(data.error || t("dashboard.failedToCreate")); setLoading(false); return; }
      setName(""); setPin(""); setCreating(false); onRefresh();
    } catch { setError(t("dashboard.networkError")); }
    setLoading(false);
  };

  const toggleActive = async (id: string, active: boolean) => {
    await ownerFetch(ownerId, "/api/staff", { method: "PATCH", body: JSON.stringify({ id, active: !active }) });
    onRefresh();
  };

  const handleEndShift = async (staffId: string) => {
    setEndingShift(staffId);
    try {
      const res = await ownerFetch(ownerId, "/api/staff/end-shift", {
        method: "POST",
        body: JSON.stringify({ staffId, restaurantId }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.transferred > 0) {
          setShiftResult(`Shift ended. ${data.transferred} table${data.transferred > 1 ? "s" : ""} transferred to ${data.newWaiterName || "unassigned"}`);
        } else {
          setShiftResult("Shift ended. No active tables to transfer.");
        }
        onRefresh();
        setTimeout(() => setShiftResult(null), 5000);
      }
    } catch { setShiftResult("Failed to end shift"); }
    setEndingShift(null);
  };

  const generatePin = () => setPin(String(Math.floor(1000 + Math.random() * 9000)));

  const handleResetPin = async (staffId: string) => {
    setResetError(null);
    if (resetPin.length < 4 || resetPin.length > 6 || !/^\d+$/.test(resetPin)) {
      setResetError("PIN must be 4-6 digits");
      return;
    }
    setResetBusy(true);
    try {
      const res = await ownerFetch(ownerId, "/api/staff", {
        method: "PATCH",
        body: JSON.stringify({ id: staffId, pin: resetPin, restaurantId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setResetError(data.error || "Reset failed");
      } else {
        setResettingId(null);
        setResetPin("");
        onRefresh();
      }
    } catch { setResetError("Network error"); }
    setResetBusy(false);
  };

  const roleColors: Record<string, { bg: string; border: string; text: string }> = {
    OWNER: { bg: "bg-sunset-400/10", border: "border-sunset-400/30", text: "text-sunset-500" },
    FLOOR_MANAGER: { bg: "bg-ocean-50", border: "border-ocean-200", text: "text-ocean-600" },
    WAITER: { bg: "bg-ocean-50", border: "border-ocean-200", text: "text-ocean-600" },
    KITCHEN: { bg: "bg-success/5", border: "border-success/20", text: "text-success" },
    BAR: { bg: "bg-status-wait-50", border: "border-status-wait-200", text: "text-status-wait-600" },
    CASHIER: { bg: "bg-status-warn-50", border: "border-status-warn-200", text: "text-status-warn-600" },
    DELIVERY: { bg: "bg-status-warn-50", border: "border-status-warn-200", text: "text-status-warn-600" },
  };

  return (
    <div className="space-y-4">
      {shiftResult && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 rounded-xl bg-status-warn-50 border border-status-warn-200 text-status-warn-800 text-sm font-medium"
        >{shiftResult}</motion.div>
      )}
      <div className="card-luxury p-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-text-primary font-bold text-lg">{t("dashboard.staffManagement")}</h3>
          <div className="flex items-center gap-2">
            <button onClick={() => { setCreating(true); setError(""); }} className="btn-primary !text-sm !px-4 !py-2">{t("dashboard.newStaff")}</button>
          </div>
        </div>
        <p className="text-text-muted text-sm">{staff.filter((s) => s.active).length} active · {staff.length} total</p>
      </div>

      <AnimatePresence>
        {creating && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="card-luxury p-5">
              <h4 className="text-text-primary font-bold text-sm mb-4">{t("dashboard.createStaffAccount")}</h4>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] text-text-muted font-semibold uppercase tracking-wider block mb-1.5">{t("dashboard.name")}</label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ahmed" className="w-full px-4 py-2.5 rounded-xl bg-sand-50 border border-sand-200 text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-ocean-400 transition" />
                </div>
                <div>
                  <label className="text-[10px] text-text-muted font-semibold uppercase tracking-wider block mb-1.5">{t("dashboard.role")}</label>
                  <div className="flex gap-2">
                    {(["WAITER", "KITCHEN", "BAR", "CASHIER", "FLOOR_MANAGER", "DELIVERY"] as const).map((r) => (
                      <button key={r} onClick={() => setRole(r)} className={`flex-1 py-2.5 rounded-xl text-[11px] font-bold transition-all border ${role === r ? `${roleColors[r]?.bg || "bg-ocean-50"} ${roleColors[r]?.border || "border-ocean-200"} ${roleColors[r]?.text || "text-ocean-700"}` : "bg-white border-sand-200 text-text-muted"}`}>
                        {r === "WAITER" ? t("dashboard.role.waiter") : r === "KITCHEN" ? t("dashboard.role.kitchen") : r === "BAR" ? t("dashboard.role.bar") : r === "CASHIER" ? t("dashboard.role.cashier") : r === "FLOOR_MANAGER" ? t("dashboard.role.floorMgr") : t("dashboard.role.driver")}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-text-muted font-semibold uppercase tracking-wider block mb-1.5">{t("dashboard.pinCode")}</label>
                  <div className="flex gap-2">
                    <input type="text" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} placeholder="4-6 digits" className="flex-1 px-4 py-2.5 rounded-xl bg-sand-50 border border-sand-200 text-text-primary text-sm font-mono tracking-widest placeholder:text-text-muted focus:outline-none focus:border-ocean-400 transition" />
                    <button onClick={generatePin} className="px-4 py-2.5 rounded-xl bg-sand-100 border border-sand-200 text-text-secondary text-sm font-bold hover:bg-sand-200 transition">{t("dashboard.generate")}</button>
                  </div>
                </div>
                {error && <p className="text-coral-600 text-xs font-medium px-1">{error}</p>}
                <div className="flex gap-2 pt-1">
                  <button onClick={handleCreate} disabled={loading} className="flex-1 btn-primary text-center disabled:opacity-50">{loading ? t("dashboard.creating") : t("dashboard.createAccount")}</button>
                  <button onClick={() => { setCreating(false); setError(""); }} className="px-6 py-3 rounded-xl bg-sand-100 border border-sand-200 text-text-secondary font-bold text-sm hover:bg-sand-200 transition">{t("common.cancel")}</button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {deleteError && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-3 rounded-xl bg-status-bad-50 border border-status-bad-200 text-status-bad-700 text-sm font-medium"
        >{deleteError}</motion.div>
      )}

      {/* Service model toggle — flips the whole restaurant between
          the legacy waiter flow and the runner-queue flow without a
          redeploy. Switching back is identical: just tap WAITER again.
          The cached cfg invalidates immediately so the next /api/sessions
          request picks up the new value. */}
      <div className="card-luxury p-4 space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h4 className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-text-secondary">
            Service Model
          </h4>
          <span className="text-[10px] text-text-muted font-extrabold uppercase tracking-wider">
            How the floor runs
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => saveServiceModel("WAITER", serviceChargePct)}
            disabled={serviceModelSaveState === "saving"}
            className={`p-4 rounded-xl border-2 text-left transition active:scale-95 disabled:opacity-60 ${
              serviceModel === "WAITER"
                ? "bg-ocean-50 border-ocean-500 text-ocean-900"
                : "bg-white border-sand-200 text-text-secondary hover:border-sand-400"
            }`}
          >
            <div className="text-sm font-extrabold mb-1">WAITER</div>
            <div className="text-[11px] font-semibold opacity-80 leading-snug">
              Tables auto-assign to a specific waiter. Tips credit per-waiter. Default for table-service cafés.
            </div>
          </button>
          <button
            onClick={() => saveServiceModel("RUNNER", serviceChargePct)}
            disabled={serviceModelSaveState === "saving"}
            className={`p-4 rounded-xl border-2 text-left transition active:scale-95 disabled:opacity-60 ${
              serviceModel === "RUNNER"
                ? "bg-status-good-50 border-status-good-500 text-status-good-900"
                : "bg-white border-sand-200 text-text-secondary hover:border-sand-400"
            }`}
          >
            <div className="text-sm font-extrabold mb-1">RUNNER</div>
            <div className="text-[11px] font-semibold opacity-80 leading-snug">
              Shared READY queue at /runner. Anyone free takes the next dish. Service charge replaces tips.
            </div>
          </button>
        </div>
        {serviceModel === "RUNNER" && (
          <div className="flex items-center gap-3 pt-1">
            <label className="text-[10px] text-text-muted font-semibold uppercase tracking-wider whitespace-nowrap">
              Service charge %
            </label>
            <input
              type="number"
              min={0}
              max={100}
              step="0.5"
              value={serviceChargePct}
              onChange={(e) => setServiceChargePct(e.target.value)}
              onBlur={() => saveServiceModel(serviceModel, serviceChargePct)}
              placeholder="0"
              className="w-24 px-3 py-2 rounded-xl bg-sand-50 border border-sand-200 text-text-primary text-sm focus:outline-none focus:border-ocean-400 transition tabular-nums"
            />
            <span className="text-[11px] text-text-muted font-semibold">
              auto-added at settle, included in printed receipt
            </span>
          </div>
        )}
        {serviceModelSaveState !== "idle" && (
          <p className={`text-[11px] font-bold ${
            serviceModelSaveState === "saved" ? "text-status-good-600" :
            serviceModelSaveState === "error" ? "text-status-bad-600" :
            "text-text-muted"
          }`}>
            {serviceModelSaveState === "saving" ? "Saving…" :
             serviceModelSaveState === "saved" ? "Saved · effective immediately" :
             "Save failed — try again"}
          </p>
        )}
      </div>

      {/* InstaPay settings — owner pastes the cafe's alias and phone here.
          Both surface to the guest on /track when they pick INSTAPAY,
          so they can transfer directly from their banking app. */}
      <div className="card-luxury p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-text-secondary">
            InstaPay
          </h4>
          <span className="text-[10px] text-text-muted font-extrabold uppercase tracking-wider">
            Shown to guests on /track
          </span>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-text-muted font-semibold uppercase tracking-wider block mb-1.5">
              InstaPay alias
            </label>
            <input
              type="text"
              value={instapayHandle}
              onChange={(e) => setInstapayHandle(e.target.value)}
              placeholder="e.g. badrnasr-cib1@instapay"
              className="w-full px-4 py-2.5 rounded-xl bg-sand-50 border border-sand-200 text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-ocean-400 transition"
              dir="ltr"
            />
          </div>
          <div>
            <label className="text-[10px] text-text-muted font-semibold uppercase tracking-wider block mb-1.5">
              Phone (registered with InstaPay)
            </label>
            <input
              type="text"
              value={instapayPhone}
              onChange={(e) => setInstapayPhone(e.target.value)}
              placeholder="e.g. 01002629534"
              className="w-full px-4 py-2.5 rounded-xl bg-sand-50 border border-sand-200 text-text-primary text-sm placeholder:text-text-muted focus:outline-none focus:border-ocean-400 transition"
              dir="ltr"
            />
          </div>
        </div>
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={saveInstapay}
            disabled={instapaySaveState === "saving"}
            className={`px-5 py-2 rounded-xl text-sm font-bold transition active:scale-95 disabled:opacity-50 ${
              instapaySaveState === "saved"
                ? "bg-status-good-500 text-white"
                : instapaySaveState === "error"
                  ? "bg-status-bad-500 text-white"
                  : "bg-sand-900 text-white hover:bg-sand-800"
            }`}
          >
            {instapaySaveState === "saving" ? "Saving…"
              : instapaySaveState === "saved" ? "Saved"
              : instapaySaveState === "error" ? "Save failed"
              : "Save"}
          </button>
          <p className="text-[11px] text-text-muted">
            Both fields are optional. Leave one blank to hide it on /track.
          </p>
        </div>
      </div>

      {(() => {
        const groups: { role: string; labelKey: string }[] = [
          { role: "WAITER", labelKey: "dashboard.staffGroups.waiters" },
          { role: "FLOOR_MANAGER", labelKey: "dashboard.staffGroups.floorManagers" },
          { role: "KITCHEN", labelKey: "dashboard.staffGroups.kitchen" },
          { role: "BAR", labelKey: "dashboard.staffGroups.bar" },
          { role: "CASHIER", labelKey: "dashboard.staffGroups.cashiers" },
          { role: "DELIVERY", labelKey: "dashboard.staffGroups.deliveryDrivers" },
        ];
        return groups.map((g) => {
          const members = staff.filter((s) => s.role === g.role);
          const rc = roleColors[g.role];
          return (
            <div key={g.role} className="space-y-2.5">
              <div className="flex items-center justify-between px-1">
                <h4 className={`text-[11px] font-extrabold uppercase tracking-[0.2em] ${rc.text}`}>
                  {t(g.labelKey)}
                </h4>
                <div className="flex items-center gap-3">
                  {g.role === "WAITER" && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-text-muted font-extrabold uppercase tracking-wider">Load cap</span>
                      <button
                        onClick={() => updateWaiterCapacity(waiterCapacity - 1)}
                        className="w-7 h-7 rounded-lg bg-sand-100 text-text-secondary text-base font-extrabold flex items-center justify-center hover:bg-sand-200 active:scale-95 transition"
                      >−</button>
                      <span className="text-sm text-text-primary font-extrabold tabular-nums w-6 text-center">{waiterCapacity}</span>
                      <button
                        onClick={() => updateWaiterCapacity(waiterCapacity + 1)}
                        className="w-7 h-7 rounded-lg bg-sand-100 text-text-secondary text-base font-extrabold flex items-center justify-center hover:bg-sand-200 active:scale-95 transition"
                      >+</button>
                    </div>
                  )}
                  <span className="text-[10px] text-text-muted font-extrabold uppercase tracking-wider">
                    {members.filter((m) => m.active).length} active
                    {members.length !== members.filter((m) => m.active).length && ` · ${members.length} total`}
                  </span>
                </div>
              </div>
              {members.length === 0 ? (
                <div className="card-luxury p-4 text-center">
                  <p className="text-text-muted text-xs">{t(g.labelKey)}</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {members.map((member) => {
                    const mrc = roleColors[member.role as keyof typeof roleColors] || roleColors.WAITER;
                    const isConfirming = confirmDelete === member.id;
                    const isDeleting = deleting === member.id;
                    const isResetting = resettingId === member.id;
                    return (
                      <motion.div key={member.id} layout className={`card-luxury p-4 ${!member.active ? "opacity-50" : ""}`}>
                        <div className="flex items-center gap-3 min-w-0 mb-3">
                          <div className={`w-12 h-12 rounded-xl ${mrc.bg} border-2 ${mrc.border} flex items-center justify-center flex-shrink-0`}>
                            <span className={`font-extrabold text-lg ${mrc.text}`}>{member.name.charAt(0).toUpperCase()}</span>
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-baseline gap-2 flex-wrap">
                              <p className="text-text-primary font-extrabold text-base break-words">{member.name}</p>
                              {member.code && (
                                <span className="text-[10px] font-mono font-extrabold text-text-secondary bg-sand-100 border border-sand-200 rounded px-1.5 py-0.5">
                                  {member.code}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                              <span className={`text-[10px] font-extrabold uppercase tracking-wider ${mrc.text}`}>{member.role === "FLOOR_MANAGER" ? "FLOOR MGR" : member.role}</span>
                              <span className="text-sand-300">·</span>
                              <span className="text-[10px] text-text-muted font-mono">
                                PIN: ••••
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                            {member.active && !isConfirming && !isResetting && (
                              <button
                                onClick={() => handleEndShift(member.id)}
                                disabled={endingShift === member.id}
                                className="px-2 py-1.5 rounded-lg bg-status-warn-50 border border-status-warn-200 text-status-warn-700 text-[10px] font-bold hover:bg-status-warn-100 transition active:scale-95 disabled:opacity-50"
                              >{endingShift === member.id ? "..." : t("dashboard.endShift")}</button>
                            )}
                            {!isConfirming && !isResetting && (
                              <button
                                onClick={() => { setResettingId(member.id); setResetPin(""); setResetError(null); }}
                                className="px-2 py-1.5 rounded-lg bg-ocean-50 border border-ocean-200 text-ocean-700 text-[10px] font-bold hover:bg-ocean-100 transition active:scale-95"
                                title={t("dashboard.resetPin")}
                              >{t("dashboard.resetPin")}</button>
                            )}
                            {!isConfirming && !isResetting && (
                              <button
                                onClick={() => toggleActive(member.id, member.active)}
                                className={`relative w-9 h-5 rounded-full transition-all ${member.active ? "bg-success" : "bg-sand-300"}`}
                                title={member.active ? t("dashboard.deactivate") : t("dashboard.activate")}
                              >
                                <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all shadow ${member.active ? "left-[18px]" : "left-0.5"}`} />
                              </button>
                            )}
                            {member.role === "OWNER" ? null : isConfirming ? (
                              <>
                                <button
                                  onClick={() => handleDelete(member.id)}
                                  disabled={isDeleting}
                                  className="px-2.5 py-1.5 rounded-lg bg-status-bad-600 text-white text-[10px] font-semibold uppercase hover:bg-status-bad-700 disabled:opacity-50"
                                >{isDeleting ? "..." : t("common.confirm")}</button>
                                <button
                                  onClick={() => setConfirmDelete(null)}
                                  className="px-2.5 py-1.5 rounded-lg bg-sand-100 border border-sand-200 text-text-secondary text-[10px] font-bold hover:bg-sand-200"
                                >{t("common.cancel")}</button>
                              </>
                            ) : !isResetting && (
                              <button
                                onClick={() => { setConfirmDelete(member.id); setTimeout(() => setConfirmDelete((c) => c === member.id ? null : c), 6000); }}
                                className="w-7 h-7 rounded-lg bg-status-bad-50 border border-status-bad-200 text-status-bad-600 text-sm hover:bg-status-bad-100 transition flex items-center justify-center"
                                title="Delete"
                                aria-label="Delete staff"
                              >
                                ✕
                              </button>
                            )}
                        </div>
                        {isResetting && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: "auto" }}
                            className="mt-3 pt-3 border-t border-sand-200 overflow-hidden"
                          >
                            <label className="text-[10px] text-text-muted font-semibold uppercase tracking-wider block mb-1.5">{t("dashboard.newPinFor").replace("{name}", member.name)}</label>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                autoFocus
                                value={resetPin}
                                onChange={(e) => setResetPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                                placeholder="4-6 digits"
                                className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-sand-50 border border-sand-200 text-text-primary text-sm font-mono tracking-widest placeholder:text-text-muted focus:outline-none focus:border-ocean-400 transition"
                              />
                              <button
                                onClick={() => setResetPin(String(Math.floor(1000 + Math.random() * 9000)))}
                                className="px-3 py-2 rounded-lg bg-sand-100 border border-sand-200 text-text-secondary text-xs font-bold hover:bg-sand-200 transition"
                              >{t("dashboard.generate")}</button>
                              <button
                                onClick={() => handleResetPin(member.id)}
                                disabled={resetBusy}
                                className="px-3 py-2 rounded-lg bg-ocean-600 text-white text-xs font-bold hover:bg-ocean-700 disabled:opacity-50 transition"
                              >{resetBusy ? "..." : t("common.save")}</button>
                              <button
                                onClick={() => { setResettingId(null); setResetPin(""); setResetError(null); }}
                                className="px-3 py-2 rounded-lg bg-sand-100 border border-sand-200 text-text-secondary text-xs font-bold hover:bg-sand-200 transition"
                              >{t("common.cancel")}</button>
                            </div>
                            {resetError && <p className="text-coral-600 text-xs font-medium mt-2">{resetError}</p>}
                            <p className="text-[10px] text-text-muted mt-2">{t("dashboard.sharePinNote").replace("{name}", member.name)}</p>
                          </motion.div>
                        )}
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        });
      })()}

      {staff.length === 0 && (
        <div className="card-luxury p-8 text-center">
          <p className="text-text-muted text-sm mb-2">{t("dashboard.noStaffYet")}</p>
          <p className="text-text-muted text-xs">{t("dashboard.noStaffYetDesc")}</p>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════
// SHIFT OVERVIEW (read-only — scheduling via Schedule tab)
// ═════════════════════════════════════════════════

function ShiftOverview({ staff, restaurantSlug: _restaurantSlug }: { staff: StaffMember[]; restaurantSlug: string }) {
  const { t } = useLanguage();
  const [currentShift, setCurrentShift] = useState(0);
  const [shiftProgress, setShiftProgress] = useState(0);
  // Clocked-in IDs piggyback on the live-snapshot poll (~30s, paused
  // when the tab is hidden). No dedicated /api/clock poll for this any
  // more — the snapshot already returns openStaffIds.
  const clockedInIds = usePerception((s) => s.openStaffIds);

  useEffect(() => {
    async function fetchShift() {
      try {
        const res = await fetch("/api/shifts");
        if (res.ok) {
          const data = await res.json();
          setCurrentShift(data.currentShift);
          setShiftProgress(data.progress);
        }
      } catch { /* silent */ }
    }
    fetchShift();
    return startPoll(fetchShift, 60000);
  }, []);

  const activeStaff = staff.filter((s) => s.active && s.role !== "OWNER");
  const nextShift = (currentShift % 3) + 1;

  const isOnCurrentShift = (s: StaffMember) => {
    if (s.shift === 0) return false;
    return getShiftTimer(s.shift, s.role).isOnShift;
  };

  const isOnNextShift = (s: StaffMember) => {
    if (s.shift === 0) return false;
    if (isOnCurrentShift(s)) return false;
    if (s.role === "CASHIER" || s.role === "DELIVERY") {
      const maxShifts = getShiftCount(s.role);
      const currentCashier = currentShift <= 1 ? 1 : currentShift === 2 ? 1 : 2;
      const nextCashier = (currentCashier % maxShifts) + 1;
      return s.shift === nextCashier;
    }
    return s.shift === nextShift;
  };

  const onNow = activeStaff.filter(isOnCurrentShift);
  const upNext = activeStaff.filter(isOnNextShift);
  const unassigned = activeStaff.filter((s) => s.shift === 0);

  const shiftLabels: Record<number, string> = { 1: t("dashboard.shift1"), 2: t("dashboard.shift2"), 3: t("dashboard.shift3") };
  const shiftColors: Record<number, { bg: string; border: string; text: string; dot: string }> = {
    0: { bg: "bg-sand-100", border: "border-sand-300", text: "text-sand-500", dot: "bg-sand-400" },
    1: { bg: "bg-ocean-50", border: "border-ocean-300", text: "text-ocean-600", dot: "bg-ocean-500" },
    2: { bg: "bg-ocean-50", border: "border-ocean-300", text: "text-ocean-600", dot: "bg-ocean-500" },
    3: { bg: "bg-sunset-50", border: "border-sunset-300", text: "text-sunset-600", dot: "bg-sunset-500" },
  };

  const roleBadge: Record<string, { color: string; label: string }> = {
    WAITER: { color: "text-ocean-600", label: t("dashboard.role.waiter") },
    BAR: { color: "text-status-wait-600", label: t("dashboard.role.bar") },
    KITCHEN: { color: "text-success", label: t("dashboard.role.kitchen") },
    CASHIER: { color: "text-status-warn-600", label: t("dashboard.role.cashier") },
    FLOOR_MANAGER: { color: "text-ocean-600", label: t("dashboard.role.floorMgr") },
    DELIVERY: { color: "text-status-warn-600", label: t("dashboard.role.driver") },
  };

  const sc = shiftColors[currentShift] || shiftColors[0];
  const nc = shiftColors[nextShift] || shiftColors[0];

  const StaffRow = ({ member }: { member: StaffMember }) => {
    const rb = roleBadge[member.role] || { color: "text-text-muted", label: member.role };
    const clockedIn = clockedInIds.has(member.id);
    return (
      <div className="flex items-center gap-3 p-3 rounded-xl bg-sand-50 border border-sand-200">
        <div className={`w-11 h-11 rounded-xl ${sc.bg} border-2 ${sc.border} flex items-center justify-center flex-shrink-0`}>
          <span className={`font-extrabold text-base ${sc.text}`}>{member.name.charAt(0)}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-extrabold text-text-primary truncate">{member.name}</p>
          <p className={`text-[10px] font-extrabold uppercase tracking-wider ${rb.color} mt-0.5`}>{rb.label} · {getShiftLabel(member.shift, member.role)}</p>
        </div>
        <span
          title={clockedIn ? t("dashboard.shift.clockedIn") : t("dashboard.shift.notClockedIn")}
          aria-label={clockedIn ? t("dashboard.shift.clockedIn") : t("dashboard.shift.notClockedIn")}
          className={`inline-flex items-center justify-center w-7 h-7 rounded-full transition-colors ${clockedIn ? "bg-status-good-100" : "bg-status-bad-100"}`}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className={`w-4 h-4 ${clockedIn ? "text-status-good-600 drop-shadow-[0_0_4px_rgba(34,197,94,0.55)]" : "text-status-bad-500"}`}>
            <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z" />
          </svg>
        </span>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className={`card-luxury p-5 border-2 ${sc.border}`}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span className={`w-3 h-3 rounded-full ${sc.dot} animate-pulse`} />
            <div>
              <div className="text-[10px] font-extrabold text-text-muted uppercase tracking-[0.2em]">{t("dashboard.cairoTime")}</div>
              <h3 className={`font-extrabold text-2xl ${sc.text} leading-none mt-0.5`}>{shiftLabels[currentShift] || "Loading..."}</h3>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-extrabold text-text-muted uppercase tracking-widest">Progress</div>
            <div className={`text-2xl font-extrabold tabular-nums tracking-tight leading-none ${sc.text}`}>{shiftProgress}%</div>
          </div>
        </div>
        <div className="w-full h-2.5 bg-sand-200 rounded-full overflow-hidden mb-2">
          <div className={`h-full ${sc.dot} rounded-full transition-all duration-1000`} style={{ width: `${shiftProgress}%` }} />
        </div>
        <div className="flex justify-end text-[10px] text-text-muted font-bold tabular-nums">
          <span>{Math.round((100 - shiftProgress) * 4.8)}m remaining</span>
        </div>
      </div>

      <div className="card-luxury p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className={`w-2.5 h-2.5 rounded-full ${sc.dot}`} />
          <h3 className={`font-extrabold text-[11px] uppercase tracking-[0.2em] ${sc.text}`}>{t("dashboard.shift.onNow")}</h3>
          <span className="ml-auto text-[10px] text-text-muted font-extrabold uppercase tracking-wider">{onNow.length} {t("dashboard.staffCount")}</span>
        </div>
        {onNow.length > 0 ? (
          <div className="space-y-2">
            {onNow.map((s) => <StaffRow key={s.id} member={s} />)}
          </div>
        ) : (
          <p className="text-xs text-text-muted text-center py-3">{t("dashboard.shift.noStaffCurrent")}</p>
        )}
      </div>

      <div className={`card-luxury p-5 border ${nc.border}`}>
        <div className="flex items-center gap-2 mb-4">
          <span className={`w-2.5 h-2.5 rounded-full ${nc.dot} opacity-60`} />
          <h3 className={`font-extrabold text-[11px] uppercase tracking-[0.2em] ${nc.text}`}>{t("dashboard.shift.upNext")} · {shiftLabels[nextShift]}</h3>
          <span className="ml-auto text-[10px] text-text-muted font-extrabold uppercase tracking-wider">{upNext.length} {t("dashboard.staffCount")}</span>
        </div>
        {upNext.length > 0 ? (
          <div className="space-y-2">
            {upNext.map((s) => (
              <div key={s.id} className="flex items-center gap-3 p-3 rounded-xl bg-sand-50/60 border border-sand-200/60">
                <div className={`w-11 h-11 rounded-xl ${nc.bg} border-2 ${nc.border} flex items-center justify-center flex-shrink-0`}>
                  <span className={`font-extrabold text-base ${nc.text}`}>{s.name.charAt(0)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-extrabold text-text-primary truncate">{s.name}</p>
                  <p className={`text-[10px] font-extrabold uppercase tracking-wider ${roleBadge[s.role]?.color || "text-text-muted"} mt-0.5`}>{roleBadge[s.role]?.label || s.role} · {getShiftLabel(s.shift, s.role)}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-text-muted text-center py-3">{t("dashboard.shift.noStaffNext")}</p>
        )}
      </div>

      {unassigned.length > 0 && (
        <div className="card-luxury p-5 border border-sand-200">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-2.5 h-2.5 rounded-full bg-sand-400" />
            <h3 className="font-extrabold text-[11px] uppercase tracking-[0.2em] text-text-muted">{t("dashboard.shift.unassigned")}</h3>
            <span className="ml-auto text-[10px] text-text-muted font-extrabold uppercase tracking-wider">{unassigned.length}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {unassigned.map((s) => (
              <span key={s.id} className="px-3 py-1.5 rounded-lg bg-sand-50 border border-sand-200 text-xs font-extrabold text-text-secondary">
                {s.name} <span className="text-text-muted font-medium">· {roleBadge[s.role]?.label || s.role}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════
// KITCHEN CONFIG PANEL
// ═════════════════════════════════════════════════

function KitchenConfigPanel({ restaurantSlug, ownerId }: { restaurantSlug: string; ownerId: string | null }) {
  const { t } = useLanguage();
  const [config, setConfig] = useState<KitchenConfig>(DEFAULT_KITCHEN_CONFIG);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/restaurant/kitchen-config?restaurantId=${restaurantSlug}`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        setConfig(normalizeKitchenConfig(data));
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => { cancelled = true; };
  }, [restaurantSlug]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await ownerFetch(ownerId, "/api/restaurant/kitchen-config", {
        method: "PUT",
        body: JSON.stringify({ restaurantId: restaurantSlug, config }),
      });
      if (res.ok) {
        const saved = await res.json();
        setConfig(normalizeKitchenConfig(saved));
        setSavedAt(Date.now());
      }
    } catch { /* silent */ }
    setSaving(false);
  };

  const reset = () => setConfig(DEFAULT_KITCHEN_CONFIG);

  const setMaxParallel = (n: number) => setConfig((c) => ({ ...c, maxParallel: Math.max(1, n) }));
  const setStation = (key: keyof KitchenConfig["stationCaps"], n: number) =>
    setConfig((c) => ({ ...c, stationCaps: { ...c.stationCaps, [key]: Math.max(1, n) } }));
  const setThreshold = (key: "warn" | "critical", n: number) =>
    setConfig((c) => ({ ...c, thresholds: { ...c.thresholds, [key]: Math.max(0, Math.min(100, n)) } }));

  const stationKeys = Object.keys(DEFAULT_KITCHEN_CONFIG.stationCaps) as Array<keyof KitchenConfig["stationCaps"]>;

  const validationError =
    config.thresholds.warn > config.thresholds.critical
      ? "Warn threshold cannot exceed critical."
      : null;

  return (
    <div className="card-luxury p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-text-primary font-extrabold text-[11px] uppercase tracking-[0.2em]">{t("dashboard.kitchenCapacity")}</h3>
        {savedAt && Date.now() - savedAt < 3000 && (
          <span className="text-[10px] font-extrabold uppercase tracking-wider text-success px-2 py-1 rounded-full bg-success/10">Saved</span>
        )}
      </div>

      {!loaded ? (
        <p className="text-xs text-text-muted">Loading…</p>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="text-[10px] font-bold text-text-muted uppercase block mb-1">Max parallel orders</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                value={config.maxParallel}
                onChange={(e) => setMaxParallel(parseInt(e.target.value, 10) || 1)}
                className="w-24 px-3 py-2 rounded-lg border border-sand-300 text-sm font-bold text-text-primary"
              />
              <span className="text-[11px] text-text-muted">= 100% load</span>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold text-text-muted uppercase block mb-2">Per-station caps</label>
            <div className="grid grid-cols-2 gap-2">
              {stationKeys.map((key) => (
                <div key={key} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-sand-50 border border-sand-200">
                  <span className="text-[11px] font-bold text-text-secondary uppercase">{key}</span>
                  <input
                    type="number"
                    min={0}
                    value={config.stationCaps[key]}
                    onChange={(e) => setStation(key, parseInt(e.target.value, 10) || 0)}
                    className="w-16 px-2 py-1 rounded-md border border-sand-300 text-xs font-bold text-right"
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold text-text-muted uppercase block mb-2">Alert thresholds (%)</label>
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-status-warn-50 border border-status-warn-200">
                <span className="text-[11px] font-bold text-status-warn-700 uppercase">Warn</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={config.thresholds.warn}
                  onChange={(e) => setThreshold("warn", parseInt(e.target.value, 10) || 0)}
                  className="w-16 px-2 py-1 rounded-md border border-status-warn-300 text-xs font-bold text-right"
                />
              </div>
              <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-status-bad-50 border border-status-bad-200">
                <span className="text-[11px] font-bold text-status-bad-700 uppercase">Critical</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={config.thresholds.critical}
                  onChange={(e) => setThreshold("critical", parseInt(e.target.value, 10) || 0)}
                  className="w-16 px-2 py-1 rounded-md border border-status-bad-300 text-xs font-bold text-right"
                />
              </div>
            </div>
          </div>

          {validationError && (
            <p className="text-[11px] text-status-bad-600 font-bold bg-status-bad-50 border border-status-bad-200 rounded-lg px-2 py-1.5">
              {validationError}
            </p>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button
              onClick={save}
              disabled={saving || !!validationError}
              className="flex-1 px-3 py-2 rounded-lg bg-gradient-to-br from-ocean-500 to-ocean-600 text-white text-xs font-semibold uppercase hover:brightness-110 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {saving ? t("dashboard.saving") : t("common.save")}
            </button>
            <button
              onClick={reset}
              className="px-3 py-2 rounded-lg bg-sand-100 border border-sand-300 text-text-secondary text-xs font-bold hover:bg-sand-200 transition"
            >
              {t("dashboard.resetDefaults")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════
// PAYMENT BREAKDOWN
// ═════════════════════════════════════════════════

function PaymentBreakdown({ orders }: { orders: LiveOrder[] }) {
  const { t } = useLanguage();
  const paidOrders = orders.filter((o) => o.status === "paid" && o.paymentMethod);
  const cashTotal = paidOrders.filter((o) => o.paymentMethod === "CASH").reduce((s, o) => s + o.total, 0);
  const cardTotal = paidOrders.filter((o) => o.paymentMethod === "CARD").reduce((s, o) => s + o.total, 0);
  const instapayTotal = paidOrders.filter((o) => o.paymentMethod === "INSTAPAY").reduce((s, o) => s + o.total, 0);
  const unpaidTotal = orders.filter((o) => o.status !== "paid" && o.status !== "pending" && o.status !== "cancelled").reduce((s, o) => s + o.total, 0);
  const grandTotal = cashTotal + cardTotal + instapayTotal;

  const cashCount = paidOrders.filter((o) => o.paymentMethod === "CASH").length;
  const cardCount = paidOrders.filter((o) => o.paymentMethod === "CARD").length;
  const instapayCount = paidOrders.filter((o) => o.paymentMethod === "INSTAPAY").length;

  return (
    <div className="card-luxury p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-text-primary font-extrabold text-[11px] uppercase tracking-[0.2em]">
          {t("dashboard.revenueBreakdownTitle")}
        </h3>
        {cashTotal > 0 && <span className="text-[10px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-full bg-status-good-100 text-status-good-700">{t("dashboard.cashToCollectBadge")}</span>}
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        <div className="p-3 rounded-xl bg-status-good-50 border border-status-good-200 text-center">
          <p className="text-[9px] text-status-good-600 font-extrabold uppercase tracking-widest mb-1">Cash · {cashCount}</p>
          <p className="text-2xl font-extrabold text-status-good-700 tabular-nums leading-none tracking-tight">{formatEGP(cashTotal)}</p>
        </div>
        <div className="p-3 rounded-xl bg-status-info-50 border border-status-info-200 text-center">
          <p className="text-[9px] text-status-info-600 font-extrabold uppercase tracking-widest mb-1">Card · {cardCount}</p>
          <p className="text-2xl font-extrabold text-status-info-700 tabular-nums leading-none tracking-tight">{formatEGP(cardTotal)}</p>
        </div>
        <div className="p-3 rounded-xl bg-status-wait-50 border border-status-wait-200 text-center">
          <p className="text-[9px] text-status-wait-600 font-extrabold uppercase tracking-widest mb-1">InstaPay · {instapayCount}</p>
          <p className="text-2xl font-extrabold text-status-wait-700 tabular-nums leading-none tracking-tight">{formatEGP(instapayTotal)}</p>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex justify-between items-baseline border-t-2 border-sand-200 pt-3">
          <span className="text-[10px] text-text-secondary font-extrabold uppercase tracking-widest">{t("dashboard.totalCollected")}</span>
          <span className="text-2xl font-extrabold text-text-primary tabular-nums tracking-tight leading-none">{formatEGP(grandTotal)}</span>
        </div>
        {cashTotal > 0 && (
          <div className="flex justify-between items-baseline p-3 rounded-xl bg-status-warn-50 border border-status-warn-200">
            <span className="text-[10px] text-status-warn-800 font-extrabold uppercase tracking-widest">{t("dashboard.cashToReconcile")}</span>
            <span className="text-lg font-extrabold text-status-warn-900 tabular-nums tracking-tight leading-none">{formatEGP(cashTotal)}</span>
          </div>
        )}
        {unpaidTotal > 0 && (
          <div className="flex justify-between items-baseline">
            <span className="text-[10px] text-text-muted font-extrabold uppercase tracking-widest">{t("dashboard.outstandingUnpaid")}</span>
            <span className="text-lg font-extrabold text-coral-600 tabular-nums tracking-tight leading-none">{formatEGP(unpaidTotal)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════
// KITCHEN STATUS
// ═════════════════════════════════════════════════

type ProductionMetrics = { activeOrders: number; avgPrepTime: number; bottleneckItems: string[]; capacity: number; stuckOrders: string[] };

function KitchenStatus({ kitchen, bar }: { kitchen: ProductionMetrics; bar?: ProductionMetrics }) {
  const { t } = useLanguage();
  return (
    <div className="space-y-3">
      <ProductionCard label={t("dashboard.role.kitchen")} metrics={kitchen} />
      {bar && <ProductionCard label={t("dashboard.role.bar")} metrics={bar} />}
    </div>
  );
}

function ProductionCard({ label, metrics }: { label: string; metrics: ProductionMetrics }) {
  const capacityColor = metrics.capacity > 80 ? "text-coral-600" : metrics.capacity > 50 ? "text-sunset-500" : "text-success";
  const capacityBg = metrics.capacity > 80 ? "bg-coral-500" : metrics.capacity > 50 ? "bg-sunset-400" : "bg-success";
  const kitchen = metrics;

  return (
    <div className="card-luxury p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-text-primary font-extrabold text-[11px] uppercase tracking-[0.2em] flex items-center gap-2">
          {kitchen.capacity > 80 && <span className="w-2 h-2 rounded-full bg-coral-500 animate-pulse" />}
          {label}
        </h3>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-3">
        <div className="text-center">
          <p className="text-[9px] text-text-muted font-extrabold uppercase tracking-widest mb-1">Active</p>
          <p className={`text-3xl font-extrabold tabular-nums tracking-tight leading-none ${capacityColor}`}>{kitchen.activeOrders}</p>
        </div>
        <div className="text-center">
          <p className="text-[9px] text-text-muted font-extrabold uppercase tracking-widest mb-1">Avg Prep</p>
          <p className="text-3xl font-extrabold text-text-primary tabular-nums tracking-tight leading-none">{kitchen.avgPrepTime > 0 ? `${kitchen.avgPrepTime}m` : "—"}</p>
        </div>
        <div className="text-center">
          <p className="text-[9px] text-text-muted font-extrabold uppercase tracking-widest mb-1">Capacity</p>
          <p className={`text-3xl font-extrabold tabular-nums tracking-tight leading-none ${capacityColor}`}>{kitchen.capacity}%</p>
        </div>
      </div>
      <div className="w-full h-2 bg-sand-200 rounded-full overflow-hidden">
        <div className={`h-full ${capacityBg} rounded-full transition-all duration-500`} style={{ width: `${Math.min(100, kitchen.capacity)}%` }} />
      </div>
      {kitchen.stuckOrders.length > 0 && (
        <div className="mt-3 px-3 py-2 rounded-lg bg-coral-50 border border-coral-200 text-xs text-coral-700">
          {kitchen.stuckOrders.length} stuck order{kitchen.stuckOrders.length !== 1 ? "s" : ""} — needs attention
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════
// PERFORMANCE LADDER
// ═════════════════════════════════════════════════

type WaiterPerf = {
  id: string;
  name: string;
  active: boolean;
  shift: number;
  sessionsHandled: number;
  ordersHandled: number;
  totalRevenue: number;
  cashRevenue: number;
  cardRevenue: number;
  itemsServed: number;
  paidOrders: number;
  avgOrderValue: number;
  avgSessionMinutes: number;
  avgServingMinutes: number;
  avgTurnaroundMinutes: number;
  tablesPerHour: number;
  closedSessions: number;
  performanceScore: number;
};

const RANK_MEDALS = ["🥇", "🥈", "🥉"];
const PERIOD_LABELS: Record<string, string> = { day: "Today", week: "This Week", month: "This Month" };

// ═══════════════════════════════════════════════
// CASHOUT PANEL — Date range cash tracker
// ═══════════════════════════════════════════════

type CashoutWaiter = {
  id: string;
  name: string;
  cashInPocket: number;
  cashOrders: number;
  cardTotal: number;
  cardOrders: number;
  totalRevenue: number;
  totalOrders: number;
  tablesServed: number[];
};

type CashoutShift = {
  shift: number;
  label: string;
  cash: number;
  card: number;
  revenue: number;
  waiters: CashoutWaiter[];
};

type CashoutDay = {
  date: string;
  cash: number;
  card: number;
  revenue: number;
  shifts: CashoutShift[];
};

type CashoutData = {
  from: string;
  to: string;
  currentShift: number;
  days: CashoutDay[];
  totals: { cash: number; card: number; revenue: number };
};

function todayCairoLocal(): string {
  const now = new Date();
  const cairo = nowInRestaurantTz(now);
  return `${cairo.getFullYear()}-${String(cairo.getMonth() + 1).padStart(2, "0")}-${String(cairo.getDate()).padStart(2, "0")}`;
}

function DangerZone({ restaurantId, ownerId }: { restaurantId: string; ownerId: string | null }) {
  const { t } = useLanguage();
  const [clearing, setClearing] = useState(false);
  const [goingLive, setGoingLive] = useState(false);
  const [goLiveStep, setGoLiveStep] = useState(0);
  const [goLiveResult, setGoLiveResult] = useState<Record<string, number> | null>(null);

  const [ownerName, setOwnerName] = useState("");
  const [ownerNameLoaded, setOwnerNameLoaded] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (ownerId && !ownerNameLoaded) {
      ownerFetch(ownerId, `/api/staff/owner?id=${ownerId}`)
        .then((r) => r.json())
        .then((d) => { if (d.name) { setOwnerName(d.name); setOwnerNameLoaded(true); } })
        .catch(() => {});
    }
  }, [ownerId, ownerNameLoaded]);

  const handleClearAll = async () => {
    if (!confirm(t("dashboard.confirm.resetAll"))) return;
    setClearing(true);
    try {
      const res = await ownerFetch(ownerId, "/api/clear", {
        method: "POST",
        body: JSON.stringify({ restaurantId }),
      });
      if (!res.ok) { alert(t("dashboard.alert.resetFailed")); setClearing(false); return; }
      window.location.reload();
    } catch { alert(t("dashboard.alert.resetFailedNetwork")); }
    setClearing(false);
  };

  const handleGoLive = async () => {
    setGoingLive(true);
    try {
      const res = await ownerFetch(ownerId, "/api/clear", {
        method: "POST",
        body: JSON.stringify({ restaurantId, goLive: true }),
      });
      if (!res.ok) { alert(t("dashboard.alert.resetFailed")); setGoingLive(false); setGoLiveStep(0); return; }
      const data = await res.json();
      setGoLiveResult(data.deleted);
      setGoLiveStep(3);
    } catch { alert(t("dashboard.alert.resetFailedNetwork")); setGoingLive(false); setGoLiveStep(0); }
  };

  const handleProfileSave = async () => {
    if (!ownerId) return;
    setProfileSaving(true);
    setProfileMsg(null);
    try {
      const payload: Record<string, string> = { id: ownerId };
      if (ownerName.trim()) payload.name = ownerName.trim();
      if (newPin) { payload.currentPin = currentPin; payload.newPin = newPin; }
      const res = await ownerFetch(ownerId, "/api/staff/owner", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { setProfileMsg({ ok: false, text: data.error || t("common.error") }); }
      else {
        setProfileMsg({ ok: true, text: t("dashboard.ownerProfile.saved") });
        setCurrentPin("");
        setNewPin("");
        if (data.name) setOwnerName(data.name);
        try {
          const raw = localStorage.getItem("ttc_dashboard_owner");
          if (raw) {
            const obj = JSON.parse(raw);
            obj.name = data.name;
            localStorage.setItem("ttc_dashboard_owner", JSON.stringify(obj));
          }
        } catch {}
      }
    } catch { setProfileMsg({ ok: false, text: t("dashboard.alert.resetFailedNetwork") }); }
    setProfileSaving(false);
  };

  return (
    <div className="mt-6 space-y-4">
      {/* Owner Profile */}
      <div className="bg-white rounded-2xl border border-sand-200 p-5">
        <h3 className="text-[11px] font-extrabold text-text-secondary uppercase tracking-[0.2em] mb-4">{t("dashboard.ownerProfile.title")}</h3>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-extrabold text-text-muted uppercase tracking-widest mb-1.5 block">{t("dashboard.ownerProfile.name")}</label>
            <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} className="w-full px-3 py-2.5 rounded-lg border-2 border-sand-200 text-sm font-semibold focus:border-sand-400 focus:outline-none transition" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] font-extrabold text-text-muted uppercase tracking-widest mb-1.5 block">{t("dashboard.ownerProfile.currentPin")}</label>
              <input type="password" inputMode="numeric" maxLength={6} value={currentPin} onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, ""))} placeholder="••••" className="w-full px-3 py-2.5 rounded-lg border-2 border-sand-200 text-sm font-semibold tabular-nums tracking-widest focus:border-sand-400 focus:outline-none transition" />
            </div>
            <div>
              <label className="text-[10px] font-extrabold text-text-muted uppercase tracking-widest mb-1.5 block">{t("dashboard.ownerProfile.newPin")}</label>
              <input type="password" inputMode="numeric" maxLength={6} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ""))} placeholder="••••" className="w-full px-3 py-2.5 rounded-lg border-2 border-sand-200 text-sm font-semibold tabular-nums tracking-widest focus:border-sand-400 focus:outline-none transition" />
            </div>
          </div>
          {profileMsg && <p className={`text-xs font-extrabold ${profileMsg.ok ? "text-status-good-600" : "text-status-bad-600"}`}>{profileMsg.text}</p>}
          <button onClick={handleProfileSave} disabled={profileSaving || (!ownerName.trim() && !newPin)} className="w-full py-3 rounded-xl bg-sand-800 text-white font-extrabold text-sm uppercase tracking-wider hover:bg-sand-900 disabled:opacity-50 transition-all active:scale-[0.98]">
            {profileSaving ? t("common.loading") : t("dashboard.ownerProfile.save")}
          </button>
        </div>
      </div>

      {/* Go Live */}
      <div className="bg-white rounded-2xl border-2 border-status-good-300 p-5">
        <h3 className="text-[11px] font-extrabold text-status-good-700 uppercase tracking-[0.2em] mb-2 flex items-center gap-2">🚀 {t("dashboard.goLive.title")}</h3>
        <p className="text-xs text-text-secondary mb-4 leading-snug">{t("dashboard.goLive.description")}</p>
        {goLiveStep === 0 && (
          <button onClick={() => setGoLiveStep(1)} className="w-full py-3.5 rounded-xl bg-status-good-600 text-white font-extrabold text-sm uppercase tracking-wider hover:bg-status-good-700 transition-all active:scale-[0.98]">
            {t("dashboard.goLive.button")}
          </button>
        )}
        {goLiveStep === 1 && (
          <div className="space-y-3">
            <div className="bg-status-warn-50 border border-status-warn-200 rounded-xl p-3">
              <p className="text-xs font-semibold text-status-warn-800 mb-2">{t("dashboard.goLive.warning")}</p>
              <ul className="text-xs text-status-warn-700 space-y-1 list-disc list-inside">
                <li>{t("dashboard.goLive.item.orders")}</li>
                <li>{t("dashboard.goLive.item.sessions")}</li>
                <li>{t("dashboard.goLive.item.shifts")}</li>
                <li>{t("dashboard.goLive.item.settlements")}</li>
                <li>{t("dashboard.goLive.item.messages")}</li>
                <li>{t("dashboard.goLive.item.dailyCloses")}</li>
              </ul>
              <p className="text-xs font-semibold text-status-warn-800 mt-2">{t("dashboard.goLive.keeps")}</p>
              <ul className="text-xs text-status-warn-700 space-y-1 list-disc list-inside">
                <li>{t("dashboard.goLive.keep.menu")}</li>
                <li>{t("dashboard.goLive.keep.tables")}</li>
                <li>{t("dashboard.goLive.keep.staff")}</li>
                <li>{t("dashboard.goLive.keep.settings")}</li>
              </ul>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setGoLiveStep(0)} className="flex-1 py-2.5 rounded-xl bg-sand-100 text-text-secondary font-bold text-sm">{t("common.cancel")}</button>
              <button onClick={() => setGoLiveStep(2)} className="flex-1 py-2.5 rounded-xl bg-status-warn-500 text-white font-bold text-sm">{t("dashboard.goLive.confirm")}</button>
            </div>
          </div>
        )}
        {goLiveStep === 2 && (
          <div className="space-y-3">
            <p className="text-sm font-bold text-status-bad-700 text-center">{t("dashboard.goLive.finalWarning")}</p>
            <div className="flex gap-2">
              <button onClick={() => setGoLiveStep(0)} disabled={goingLive} className="flex-1 py-2.5 rounded-xl bg-sand-100 text-text-secondary font-bold text-sm">{t("common.cancel")}</button>
              <button onClick={handleGoLive} disabled={goingLive} className="flex-1 py-2.5 rounded-xl bg-status-bad-600 text-white font-bold text-sm disabled:opacity-50">
                {goingLive ? t("dashboard.goLive.wiping") : t("dashboard.goLive.finalButton")}
              </button>
            </div>
          </div>
        )}
        {goLiveStep === 3 && goLiveResult && (
          <div className="space-y-3">
            <div className="bg-status-good-50 border border-status-good-200 rounded-xl p-3 text-center">
              <p className="text-lg font-semibold text-status-good-700 mb-1">✓ {t("dashboard.goLive.success")}</p>
              <p className="text-xs text-text-secondary">{t("dashboard.goLive.successDetail")}</p>
              <div className="mt-2 grid grid-cols-2 gap-1 text-xs text-text-secondary">
                {Object.entries(goLiveResult).filter(([, v]) => v > 0).map(([k, v]) => (
                  <span key={k}>{k}: {v}</span>
                ))}
              </div>
            </div>
            <button onClick={() => window.location.reload()} className="w-full py-2.5 rounded-xl bg-status-good-600 text-white font-bold text-sm">{t("dashboard.goLive.reload")}</button>
          </div>
        )}
      </div>

      {/* Regular reset */}
      <div className="bg-white rounded-2xl border-2 border-status-bad-200 p-5">
        <h3 className="text-[11px] font-extrabold text-status-bad-700 uppercase tracking-[0.2em] mb-2 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-status-bad-500 animate-pulse" />
          {t("dashboard.dangerZone")}
        </h3>
        <p className="text-xs text-text-secondary mb-4 leading-snug">{t("dashboard.dangerZone.description")}</p>
        <button onClick={handleClearAll} disabled={clearing} className="w-full py-3.5 rounded-xl bg-status-bad-600 text-white font-extrabold text-sm uppercase tracking-wider hover:bg-status-bad-700 disabled:opacity-50 transition-all active:scale-[0.98]">
          {clearing ? t("dashboard.resetting") : t("dashboard.resetAllData")}
        </button>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════
// MENU PANEL — owner CRUD for menu items
// ═════════════════════════════════════════════════

type AdminMenuItem = {
  id: string;
  name: string;
  nameAr: string | null;
  price: number;
  description: string | null;
  descAr: string | null;
  image: string | null;
  available: boolean;
  bestSeller: boolean;
  highMargin: boolean;
  calories: number | null;
  prepTime: number | null;
  sortOrder: number;
  categoryId: string;
  availableFromHour: number | null;
  availableToHour: number | null;
  // EGP/hour rate for time-billed activity items (kayak, board,
  // massage). Null for ordinary items and flat-priced activities.
  pricePerHour: number | null;
};

type AdminCategory = {
  id: string;
  name: string;
  nameAr: string | null;
  slug: string;
  sortOrder: number;
  icon: string | null;
  availableFromHour: number | null;
  availableToHour: number | null;
  items: AdminMenuItem[];
};

type MenuDraft = {
  name: string;
  price: string;
  // EGP/hour for time-billed activities. Empty string in the form
  // means "flat-priced" (no timer billing). Stored as string in the
  // draft so the input can hold partial values mid-typing.
  pricePerHour: string;
  description: string;
  image: string;
  available: boolean;
  bestSeller: boolean;
  highMargin: boolean;
  calories: string;
  prepTime: string;
  categoryId: string;
  availableFromHour: string;
  availableToHour: string;
};

function emptyDraft(categoryId: string): MenuDraft {
  return {
    name: "",
    price: "",
    pricePerHour: "",
    description: "",
    image: "",
    available: true,
    bestSeller: false,
    highMargin: false,
    calories: "",
    prepTime: "",
    categoryId,
    availableFromHour: "",
    availableToHour: "",
  };
}

function draftFromItem(item: AdminMenuItem): MenuDraft {
  return {
    name: item.name,
    price: String(item.price),
    pricePerHour: item.pricePerHour != null ? String(item.pricePerHour) : "",
    description: item.description || "",
    image: item.image || "",
    available: item.available,
    bestSeller: item.bestSeller,
    highMargin: item.highMargin,
    calories: item.calories != null ? String(item.calories) : "",
    prepTime: item.prepTime != null ? String(item.prepTime) : "",
    categoryId: item.categoryId,
    availableFromHour: item.availableFromHour != null ? String(item.availableFromHour) : "",
    availableToHour: item.availableToHour != null ? String(item.availableToHour) : "",
  };
}

function MenuPanel({ restaurantId, ownerId }: { restaurantId: string; ownerId: string | null }) {
  const { t, lang } = useLanguage();
  const loc = (name: string, nameAr: string | null) => lang === "ar" && nameAr ? nameAr : name;
  const locDesc = (desc: string | null, descAr: string | null) => lang === "ar" && descAr ? descAr : desc;
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<MenuDraft | null>(null);
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [newDraft, setNewDraft] = useState<MenuDraft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/menu-admin?restaurantId=${restaurantId}`);
      if (!res.ok) throw new Error("Failed to load menu");
      const data = await res.json();
      const cats: AdminCategory[] = data.categories || [];
      setCategories(cats);
      if (cats.length > 0 && !activeCategory) {
        setActiveCategory(cats[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load menu");
    } finally {
      setLoading(false);
    }
    // activeCategory is intentionally omitted — only set on first load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async (categoryId: string) => {
    if (!newDraft) return;
    const price = parseFloat(newDraft.price);
    if (!newDraft.name.trim() || isNaN(price) || price < 0) {
      setError("Name and a valid price are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await ownerFetch(ownerId, "/api/menu-admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId,
          name: newDraft.name.trim(),
          price,
          // Empty / 0 → undefined so the server stores null (flat
          // pricing). Anything > 0 turns the item into a time-billed
          // activity that shows the hour picker on /menu.
          pricePerHour: newDraft.pricePerHour && parseFloat(newDraft.pricePerHour) > 0
            ? parseFloat(newDraft.pricePerHour)
            : undefined,
          description: newDraft.description.trim() || undefined,
          image: newDraft.image.trim() || undefined,
          available: newDraft.available,
          bestSeller: newDraft.bestSeller,
          highMargin: newDraft.highMargin,
          calories: newDraft.calories ? parseInt(newDraft.calories, 10) : undefined,
          prepTime: newDraft.prepTime ? parseInt(newDraft.prepTime, 10) : undefined,
          availableFromHour: newDraft.availableFromHour ? parseInt(newDraft.availableFromHour, 10) : undefined,
          availableToHour: newDraft.availableToHour ? parseInt(newDraft.availableToHour, 10) : undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to create item");
      }
      setCreatingIn(null);
      setNewDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create item");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editDraft) return;
    const price = parseFloat(editDraft.price);
    if (!editDraft.name.trim() || isNaN(price) || price < 0) {
      setError("Name and a valid price are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await ownerFetch(ownerId, "/api/menu-admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingId,
          name: editDraft.name.trim(),
          price,
          // Empty input → null (flat-priced); >0 → time-billed.
          // Saving an item with pricePerHour=null clears any prior
          // hourly setup, returning it to a normal menu line.
          pricePerHour: editDraft.pricePerHour && parseFloat(editDraft.pricePerHour) > 0
            ? parseFloat(editDraft.pricePerHour)
            : null,
          description: editDraft.description.trim() || null,
          image: editDraft.image.trim() || null,
          available: editDraft.available,
          bestSeller: editDraft.bestSeller,
          highMargin: editDraft.highMargin,
          calories: editDraft.calories ? parseInt(editDraft.calories, 10) : null,
          prepTime: editDraft.prepTime ? parseInt(editDraft.prepTime, 10) : null,
          availableFromHour: editDraft.availableFromHour ? parseInt(editDraft.availableFromHour, 10) : null,
          availableToHour: editDraft.availableToHour ? parseInt(editDraft.availableToHour, 10) : null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to save");
      }
      setEditingId(null);
      setEditDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setSaving(true);
    setError(null);
    try {
      const res = await ownerFetch(ownerId, "/api/menu-admin", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to delete");
      }
      const result = await res.json().catch(() => ({}));
      if (result.deactivated) {
        setError("Item has order history — deactivated instead of deleted");
      }
      setConfirmDelete(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    } finally {
      setSaving(false);
    }
  };

  const toggleAvailable = async (item: AdminMenuItem) => {
    setSaving(true);
    setError(null);
    try {
      const res = await ownerFetch(ownerId, "/api/menu-admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, available: !item.available }),
      });
      if (!res.ok) throw new Error("Failed to toggle availability");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to toggle");
    } finally {
      setSaving(false);
    }
  };

  const activeCat = categories.find((c) => c.id === activeCategory) || null;

  const saveCategoryHours = async (id: string, from: number | null, to: number | null) => {
    setSaving(true);
    setError(null);
    try {
      const res = await ownerFetch(ownerId, "/api/menu-admin/category", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, availableFromHour: from, availableToHour: to }),
      });
      if (!res.ok) throw new Error("Failed to save category hours");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card-luxury p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-base font-semibold text-text-primary">{t("dashboard.menuManagement")}</h3>
          <p className="text-[10px] text-text-muted">{t("dashboard.addEditItems")}</p>
        </div>
        <button
          onClick={load}
          disabled={loading || saving}
          className="text-[10px] font-bold px-2 py-1 rounded-lg bg-sand-100 text-text-secondary hover:bg-sand-200 disabled:opacity-50"
        >
          {loading ? t("dashboard.menu.loading") : t("dashboard.refresh")}
        </button>
      </div>

      {/* Hidden items banner */}
      {(() => {
        const hiddenItems = categories.flatMap((c) => c.items.filter((i) => !i.available).map((i) => ({ ...i, categoryName: c.name })));
        if (hiddenItems.length === 0) return null;
        return (
          <div className="mb-3 p-3 rounded-xl bg-status-bad-50 border border-status-bad-200">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="w-2 h-2 rounded-full bg-status-bad-500" />
              <span className="text-[11px] font-bold text-status-bad-700">{t("dashboard.menu.hiddenBanner").replace("{count}", String(hiddenItems.length))}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {hiddenItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => toggleAvailable(item)}
                  disabled={saving}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-status-bad-200 text-[10px] font-bold text-status-bad-700 hover:bg-status-bad-100 transition disabled:opacity-50"
                >
                  <span className="line-through opacity-70">{loc(item.name, item.nameAr)}</span>
                  <span className="text-status-good-600 ml-0.5">↩</span>
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {error && (
        <div className="mb-3 p-2 rounded-lg bg-status-bad-50 border border-status-bad-200 text-[11px] text-status-bad-700 flex items-start justify-between gap-2">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-status-bad-500 font-bold">×</button>
        </div>
      )}

      {!loading && categories.length === 0 && (
        <div className="text-center py-8 text-text-muted text-xs">
          {t("dashboard.menu.noCategoriesFound")}
        </div>
      )}

      {categories.length > 0 && (
        <>
          {/* Category tabs */}
          <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1 -mx-1 px-1">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all ${
                  activeCategory === cat.id
                    ? "bg-ocean-600 text-white shadow-sm"
                    : "bg-sand-100 text-text-secondary hover:bg-sand-200"
                }`}
              >
                {cat.icon && <span className="mr-1">{cat.icon}</span>}
                {loc(cat.name, cat.nameAr)}
                <span className="ml-1.5 opacity-60">({cat.items.length})</span>
              </button>
            ))}
          </div>

          {/* Category time-window editor — applies to every item in this category
              unless the item overrides it. Blank = always available. */}
          {activeCat && (
            <CategoryHoursEditor
              key={activeCat.id}
              cat={activeCat}
              saving={saving}
              onSave={(from, to) => saveCategoryHours(activeCat.id, from, to)}
            />
          )}

          {/* Items in active category */}
          {activeCat && (
            <div className="space-y-2">
              {activeCat.items.map((item) => {
                const isEditing = editingId === item.id;
                const isConfirming = confirmDelete === item.id;

                if (isEditing && editDraft) {
                  return (
                    <div key={item.id} className="p-3 rounded-xl border-2 border-ocean-300 bg-ocean-50/40">
                      <MenuItemForm draft={editDraft} setDraft={setEditDraft as (d: MenuDraft) => void} />
                      <div className="flex gap-2 mt-3">
                        <button
                          onClick={handleSaveEdit}
                          disabled={saving}
                          className="flex-1 py-2 rounded-lg bg-ocean-600 text-white text-xs font-bold hover:bg-ocean-700 disabled:opacity-50"
                        >
                          {saving ? t("dashboard.saving") : t("common.save")}
                        </button>
                        <button
                          onClick={() => { setEditingId(null); setEditDraft(null); }}
                          disabled={saving}
                          className="px-3 py-2 rounded-lg bg-sand-100 text-text-secondary text-xs font-bold hover:bg-sand-200"
                        >
                          {t("common.cancel")}
                        </button>
                      </div>
                    </div>
                  );
                }

                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-3 p-2.5 rounded-xl border ${
                      item.available ? "border-sand-200 bg-white" : "border-sand-200 bg-sand-50 opacity-60"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-text-primary truncate">{loc(item.name, item.nameAr)}</span>
                        {item.bestSeller && (
                          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-sunset-100 text-sunset-700">{t("dashboard.menu.top")}</span>
                        )}
                        {item.highMargin && (
                          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-status-good-100 text-status-good-700">{t("dashboard.menu.hm")}</span>
                        )}
                        {!item.available && (
                          <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-status-bad-100 text-status-bad-700">{t("dashboard.menu.off")}</span>
                        )}
                      </div>
                      {(item.description || item.descAr) && (
                        <p className="text-[10px] text-text-muted truncate">{locDesc(item.description, item.descAr)}</p>
                      )}
                      <p className="text-[11px] font-bold text-success mt-0.5">{formatEGP(item.price)} {t("common.egp")}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => toggleAvailable(item)}
                        disabled={saving}
                        className={`text-[9px] font-bold px-2 py-1 rounded-lg ${
                          item.available
                            ? "bg-status-good-100 text-status-good-700 hover:bg-status-good-200"
                            : "bg-sand-200 text-text-muted hover:bg-sand-300"
                        } disabled:opacity-50`}
                      >
                        {item.available ? t("dashboard.menu.on") : t("dashboard.menu.off")}
                      </button>
                      <button
                        onClick={() => { setEditingId(item.id); setEditDraft(draftFromItem(item)); }}
                        className="text-[9px] font-bold px-2 py-1 rounded-lg bg-ocean-100 text-ocean-700 hover:bg-ocean-200"
                      >
                        {t("dashboard.menu.edit")}
                      </button>
                      {isConfirming ? (
                        <button
                          onClick={() => handleDelete(item.id)}
                          disabled={saving}
                          className="text-[9px] font-bold px-2 py-1 rounded-lg bg-status-bad-600 text-white hover:bg-status-bad-700 ring-2 ring-status-bad-200"
                        >
                          {t("dashboard.menu.confirm")}
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setConfirmDelete(item.id);
                            setTimeout(() => setConfirmDelete((c) => (c === item.id ? null : c)), 5000);
                          }}
                          className="text-[9px] font-bold px-2 py-1 rounded-lg bg-status-bad-50 text-status-bad-600 hover:bg-status-bad-100"
                        >
                          {t("dashboard.menu.del")}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Add item */}
              {creatingIn === activeCat.id && newDraft ? (
                <div className="p-3 rounded-xl border-2 border-ocean-300 bg-ocean-50/40">
                  <MenuItemForm draft={newDraft} setDraft={setNewDraft as (d: MenuDraft) => void} />
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => handleCreate(activeCat.id)}
                      disabled={saving}
                      className="flex-1 py-2 rounded-lg bg-ocean-600 text-white text-xs font-bold hover:bg-ocean-700 disabled:opacity-50"
                    >
                      {saving ? t("dashboard.menu.creating") : t("dashboard.menu.createItem")}
                    </button>
                    <button
                      onClick={() => { setCreatingIn(null); setNewDraft(null); }}
                      disabled={saving}
                      className="px-3 py-2 rounded-lg bg-sand-100 text-text-secondary text-xs font-bold hover:bg-sand-200"
                    >
                      {t("common.cancel")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setCreatingIn(activeCat.id); setNewDraft(emptyDraft(activeCat.id)); }}
                  className="w-full py-2.5 rounded-xl border-2 border-dashed border-sand-300 text-text-muted text-xs font-bold hover:border-ocean-300 hover:text-ocean-600 transition-all"
                >
                  {t("dashboard.menu.addItemTo").replace("{name}", activeCat.name)}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CategoryHoursEditor({
  cat,
  saving,
  onSave,
}: {
  cat: AdminCategory;
  saving: boolean;
  onSave: (from: number | null, to: number | null) => void | Promise<void>;
}) {
  const { t } = useLanguage();
  const [from, setFrom] = useState<string>(cat.availableFromHour != null ? String(cat.availableFromHour) : "");
  const [to, setTo] = useState<string>(cat.availableToHour != null ? String(cat.availableToHour) : "");
  const parse = (v: string): number | null => {
    if (v.trim() === "") return null;
    const n = parseInt(v, 10);
    if (Number.isNaN(n) || n < 0 || n > 23) return null;
    return n;
  };
  const dirty =
    parse(from) !== cat.availableFromHour || parse(to) !== cat.availableToHour;
  const label =
    cat.availableFromHour == null && cat.availableToHour == null
      ? t("dashboard.menu.alwaysAvailable")
      : t("dashboard.menu.visibleHours").replace("{from}", String(cat.availableFromHour ?? 0)).replace("{to}", String(cat.availableToHour ?? 24));
  return (
    <div className="mb-3 p-3 rounded-xl bg-sand-50 border border-sand-200">
      <div className="flex items-center justify-between mb-2">
        <div>
          <div className="text-[11px] font-bold text-text-primary">{t("dashboard.menu.categoryHours").replace("{name}", cat.name)}</div>
          <div className="text-[10px] text-text-secondary">{label} · {t("dashboard.menu.inheritNotice")}</div>
        </div>
        {(cat.availableFromHour != null || cat.availableToHour != null) && (
          <button
            onClick={() => { setFrom(""); setTo(""); onSave(null, null); }}
            disabled={saving}
            className="text-[10px] font-bold text-text-secondary underline disabled:opacity-50"
          >
            {t("dashboard.menu.clear")}
          </button>
        )}
      </div>
      <div className="flex items-end gap-2">
        <label className="flex-1">
          <div className="text-[10px] text-text-secondary mb-0.5">{t("dashboard.menu.fromHour")}</div>
          <input
            type="number"
            min={0}
            max={23}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder="—"
            className="w-full px-2 py-1.5 rounded-lg border border-sand-200 text-xs"
          />
        </label>
        <label className="flex-1">
          <div className="text-[10px] text-text-secondary mb-0.5">{t("dashboard.menu.toHour")}</div>
          <input
            type="number"
            min={0}
            max={23}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="—"
            className="w-full px-2 py-1.5 rounded-lg border border-sand-200 text-xs"
          />
        </label>
        <button
          onClick={() => onSave(parse(from), parse(to))}
          disabled={saving || !dirty}
          className="px-3 py-1.5 rounded-lg bg-ocean-600 text-white text-[11px] font-bold hover:bg-ocean-700 disabled:opacity-50"
        >
          {saving ? t("dashboard.saving") : t("common.save")}
        </button>
      </div>
    </div>
  );
}

function MenuItemForm({ draft, setDraft }: { draft: MenuDraft; setDraft: (d: MenuDraft) => void }) {
  const { t } = useLanguage();
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        <input
          type="text"
          placeholder={t("dashboard.menu.name")}
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          className="col-span-2 px-2.5 py-1.5 rounded-lg border border-sand-200 text-xs font-semibold focus:border-ocean-400 focus:outline-none"
        />
        <input
          type="number"
          placeholder={t("dashboard.menu.price")}
          step="0.01"
          value={draft.price}
          onChange={(e) => setDraft({ ...draft, price: e.target.value })}
          className="px-2.5 py-1.5 rounded-lg border border-sand-200 text-xs font-semibold focus:border-ocean-400 focus:outline-none"
        />
      </div>
      <textarea
        placeholder={t("dashboard.menu.description")}
        value={draft.description}
        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        rows={2}
        className="w-full px-2.5 py-1.5 rounded-lg border border-sand-200 text-xs resize-none focus:border-ocean-400 focus:outline-none"
      />
      <input
        type="text"
        placeholder={t("dashboard.menu.imageUrl")}
        value={draft.image}
        onChange={(e) => setDraft({ ...draft, image: e.target.value })}
        className="w-full px-2.5 py-1.5 rounded-lg border border-sand-200 text-xs focus:border-ocean-400 focus:outline-none"
      />
      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          placeholder={t("dashboard.menu.calories")}
          value={draft.calories}
          onChange={(e) => setDraft({ ...draft, calories: e.target.value })}
          className="px-2.5 py-1.5 rounded-lg border border-sand-200 text-xs focus:border-ocean-400 focus:outline-none"
        />
        <input
          type="number"
          placeholder={t("dashboard.menu.prepTime")}
          value={draft.prepTime}
          onChange={(e) => setDraft({ ...draft, prepTime: e.target.value })}
          className="px-2.5 py-1.5 rounded-lg border border-sand-200 text-xs focus:border-ocean-400 focus:outline-none"
        />
      </div>
      {/* Time-billed activity rate. Filling this turns the item into a
          per-hour activity (kayak / board / massage style) — the guest
          menu shows a 1/2/3 hour picker and the bill is hours × this
          rate. Leave blank for ordinary items and flat-priced
          activities (e.g. pool ticket). */}
      <div className="grid grid-cols-[auto_1fr] gap-2 items-center">
        <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">
          {t("dashboard.menu.pricePerHour")}
        </span>
        <input
          type="number"
          min={0}
          step="1"
          placeholder={t("dashboard.menu.pricePerHourPlaceholder")}
          value={draft.pricePerHour}
          onChange={(e) => setDraft({ ...draft, pricePerHour: e.target.value })}
          className="px-2.5 py-1.5 rounded-lg border border-sand-200 text-xs focus:border-ocean-400 focus:outline-none"
        />
      </div>
      <div className="grid grid-cols-[auto_1fr_1fr] gap-2 items-center">
        <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">{t("dashboard.menu.hours")}</span>
        <input
          type="number"
          min={0}
          max={23}
          placeholder={t("dashboard.menu.fromExample")}
          value={draft.availableFromHour}
          onChange={(e) => setDraft({ ...draft, availableFromHour: e.target.value })}
          className="px-2.5 py-1.5 rounded-lg border border-sand-200 text-xs focus:border-ocean-400 focus:outline-none"
        />
        <input
          type="number"
          min={0}
          max={24}
          placeholder={t("dashboard.menu.toExample")}
          value={draft.availableToHour}
          onChange={(e) => setDraft({ ...draft, availableToHour: e.target.value })}
          className="px-2.5 py-1.5 rounded-lg border border-sand-200 text-xs focus:border-ocean-400 focus:outline-none"
        />
      </div>
      <div className="flex flex-wrap gap-2 text-[10px] font-bold">
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.available}
            onChange={(e) => setDraft({ ...draft, available: e.target.checked })}
          />
          {t("dashboard.menu.available")}
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.bestSeller}
            onChange={(e) => setDraft({ ...draft, bestSeller: e.target.checked })}
          />
          {t("dashboard.menu.bestSeller")}
        </label>
        <label className="flex items-center gap-1 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.highMargin}
            onChange={(e) => setDraft({ ...draft, highMargin: e.target.checked })}
          />
          {t("dashboard.menu.highMargin")}
        </label>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════
// ANALYTICS PANEL — owner-friendly day/week/month view
// ═════════════════════════════════════════════════

type AnalyticsData = {
  period: "day" | "week" | "month";
  since: string;
  summary: { revenue: number; orders: number; sessions: number; guests: number; avgCheck: number; ordersPerHour?: number };
  timeseries: { t: number; revenue: number; orders: number }[];
  hourHeatmap: { hour: number; revenue: number; orders: number }[];
  topItems: { id: string; name: string; qty: number; revenue: number }[];
  paymentMix: Record<string, { count: number; revenue: number }>;
  staffQuality: {
    id: string;
    name: string;
    active: boolean;
    ordersHandled: number;
    tablesHandled: number;
    avgServeFromReadyMin: number | null;
    serveSamples: number;
  }[];
  kitchen: { avgPrepMin: number | null; samples: number };
  cancellations?: {
    items: number;
    revenue: number;
    topReasons: { reason: string; count: number }[];
    topItems: { name: string; qty: number; revenue: number }[];
  };
};

function AnalyticsPanel({ restaurantId, ownerId }: { restaurantId: string; ownerId: string | null }) {
  const { t } = useLanguage();
  const [period, setPeriod] = useState<"day" | "week" | "month">("day");
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [cashData, setCashData] = useState<CashoutData | null>(null);

  useEffect(() => {
    let stale = false;
    setLoading(true);
    ownerFetch(ownerId, `/api/analytics?restaurantId=${restaurantId}&period=${period}`)
      .then((r) => r.json())
      .then((d) => { if (!stale) { setData(d); setLoading(false); } })
      .catch(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [restaurantId, period]);

  useEffect(() => {
    const today = todayCairoLocal();
    const from = period === "day" ? today : period === "week"
      ? (() => { const d = new Date(today + "T00:00:00"); const w = new Date(d.getTime() - 6 * 86400000); return `${w.getFullYear()}-${String(w.getMonth() + 1).padStart(2, "0")}-${String(w.getDate()).padStart(2, "0")}`; })()
      : (() => { const d = new Date(today + "T00:00:00"); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; })();
    ownerFetch(ownerId, `/api/shifts/cashout?restaurantId=${restaurantId}&from=${from}&to=${today}`)
      .then((r) => r.json())
      .then((d) => setCashData(d))
      .catch(() => {});
  }, [restaurantId, period]);

  const periodLabel = period === "day" ? t("dashboard.analytics.periodToday") : period === "week" ? t("dashboard.analytics.periodWeek") : t("dashboard.analytics.periodMonth");

  return (
    <div className="space-y-4">
      {/* Header + period tabs */}
      <div className="card-luxury p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-base font-semibold text-text-primary">{t("dashboard.nav.analytics")}</h3>
            <p className="text-[10px] text-text-muted">{periodLabel}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {(["day", "week", "month"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`flex-1 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                period === p ? "bg-ocean-500 text-white shadow-md" : "bg-sand-100 text-text-muted hover:bg-sand-200"
              }`}
            >
              {p === "day" ? t("common.today") : p === "week" ? t("dashboard.analytics.week") : t("dashboard.analytics.month")}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="card-luxury p-12 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-ocean-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : !data ? (
        <div className="card-luxury p-12 text-center text-text-muted text-sm">{t("dashboard.analytics.failedLoad")}</div>
      ) : (
        <>
          {/* Summary KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <KpiCard icon="◈" label={t("dashboard.analytics.revenue")} value={data.summary.revenue} unit={t("common.egp")} accent="text-success" sub={`${data.summary.ordersPerHour ?? 0} ${t("dashboard.kpi.ordersPerHour")}`} />
            <KpiCard icon="◇" label={t("dashboard.analytics.paidOrders")} value={data.summary.orders} accent="text-ocean-600" sub={`${formatEGP(data.summary.avgCheck)} ${t("dashboard.kpi.avg")}`} />
            <KpiCard icon="◎" label={t("dashboard.analytics.guests")} value={data.summary.guests} accent="text-sunset-500" sub={data.summary.sessions > 0 ? `${(data.summary.guests / data.summary.sessions).toFixed(1)} / ${t("common.table").toLowerCase()}` : "—"} />
            <KpiCard icon="⏱" label={t("dashboard.analytics.kitchenPrep")} value={data.kitchen.avgPrepMin ?? 0} unit={t("common.minutes")} accent={data.kitchen.avgPrepMin && data.kitchen.avgPrepMin > 20 ? "text-coral-600" : "text-text-primary"} sub={data.kitchen.samples > 0 ? `${data.kitchen.samples} ${t("common.orders")}` : t("dashboard.analytics.noDataYet")} />
          </div>

          {/* Money summary */}
          {cashData && (
            <div className="card-luxury p-4">
              <h4 className="text-xs font-semibold text-text-primary mb-3 uppercase tracking-wider">{t("dashboard.revenueBreakdownTitle")}</h4>
              <div className="grid grid-cols-3 gap-3 mb-3">
                <div className="bg-status-good-50 rounded-xl p-3 text-center">
                  <p className="text-lg font-semibold text-status-good-700">{cashData.totals.cash.toLocaleString()}</p>
                  <p className="text-[10px] font-bold text-status-good-600 uppercase">{t("dashboard.analytics.cash")}</p>
                </div>
                <div className="bg-status-info-50 rounded-xl p-3 text-center">
                  <p className="text-lg font-semibold text-status-info-700">{cashData.totals.card.toLocaleString()}</p>
                  <p className="text-[10px] font-bold text-status-info-600 uppercase">{t("dashboard.analytics.cardDigital")}</p>
                </div>
                <div className="bg-sand-50 rounded-xl p-3 text-center">
                  <p className="text-lg font-semibold text-text-primary">{cashData.totals.revenue.toLocaleString()}</p>
                  <p className="text-[10px] font-bold text-text-secondary uppercase">{t("dashboard.analytics.total")}</p>
                </div>
              </div>

              {/* Per-shift breakdown */}
              {cashData.days.map((day) => (
                <div key={day.date} className="mb-2">
                  {cashData.days.length > 1 && (
                    <p className="text-[10px] font-bold text-text-muted mb-1">
                      {day.date === todayCairoLocal() ? t("common.today") : new Date(day.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                    </p>
                  )}
                  <div className="grid grid-cols-3 gap-2">
                    {day.shifts.map((shift) => (
                      <div key={shift.shift} className="p-2.5 rounded-xl bg-sand-50 border border-sand-200">
                        <p className="text-[9px] font-bold text-text-muted uppercase mb-1">{shift.label}</p>
                        <p className="text-sm font-semibold text-text-primary">{shift.revenue.toLocaleString()}</p>
                        <div className="flex gap-2 mt-0.5">
                          <span className="text-[9px] text-status-good-600">{shift.cash.toLocaleString()} {t("dashboard.analytics.cashShift")}</span>
                          <span className="text-[9px] text-status-info-500">{shift.card.toLocaleString()} {t("dashboard.analytics.cardShift")}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Revenue timeseries */}
            <div className="card-luxury p-4">
              <h4 className="text-xs font-semibold text-text-primary mb-3 uppercase tracking-wider">{t("dashboard.analytics.revenueOverTime")}</h4>
              <RevenueBars data={data.timeseries} period={period} />
            </div>

            {/* Hour heatmap */}
            <div className="card-luxury p-4">
              <h4 className="text-xs font-semibold text-text-primary mb-3 uppercase tracking-wider">{t("dashboard.analytics.busiestHours")}</h4>
              <HourHeatmap data={data.hourHeatmap} />
            </div>

            {/* Top items */}
            <div className="card-luxury p-4">
              <h4 className="text-xs font-semibold text-text-primary mb-3 uppercase tracking-wider">{t("dashboard.analytics.topSellers")}</h4>
              {data.topItems.length === 0 ? (
                <p className="text-xs text-text-muted py-6 text-center">{t("dashboard.analytics.noPaidOrders")}</p>
              ) : (
                <div className="space-y-1.5">
                  {data.topItems.map((item, i) => {
                    const topRev = data.topItems[0].revenue || 1;
                    const pct = (item.revenue / topRev) * 100;
                    return (
                      <div key={item.id} className="flex items-center gap-2">
                        <span className="text-[10px] font-bold text-text-muted w-4">#{i + 1}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-0.5">
                            <span className="text-xs font-bold text-text-primary truncate">{item.name}</span>
                            <span className="text-[10px] font-bold text-success shrink-0 ml-2">{formatEGP(item.revenue)} {t("common.egp")}</span>
                          </div>
                          <div className="h-1.5 bg-sand-100 rounded-full overflow-hidden">
                            <div className="h-full bg-ocean-500 rounded-full" style={{ width: `${pct}%` }} />
                          </div>
                          <p className="text-[9px] text-text-muted mt-0.5">{t("dashboard.analytics.sold").replace("{qty}", String(item.qty))}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Payment mix */}
            <div className="card-luxury p-4">
              <h4 className="text-xs font-semibold text-text-primary mb-3 uppercase tracking-wider">{t("dashboard.analytics.paymentMix")}</h4>
              <PaymentMix paymentMix={data.paymentMix} totalRevenue={data.summary.revenue} />
            </div>
          </div>

          {/* Cancellations */}
          {data.cancellations && data.cancellations.items > 0 && (
            <div className="card-luxury p-4">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wider">{t("dashboard.analytics.cancellations")}</h4>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-status-bad-600">{t("dashboard.analytics.itemsVoided").replace("{count}", String(data.cancellations.items))}</span>
                  <span className="text-xs font-bold text-status-bad-500">{t("dashboard.analytics.egpLost").replace("{amount}", formatEGP(data.cancellations.revenue))}</span>
                </div>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {data.cancellations.topReasons.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2">{t("dashboard.analytics.topReasons")}</p>
                    <div className="space-y-1">
                      {data.cancellations.topReasons.map((r) => (
                        <div key={r.reason} className="flex items-center justify-between p-2 rounded-lg bg-status-bad-50 border border-status-bad-100">
                          <span className="text-xs text-status-bad-700">{r.reason}</span>
                          <span className="text-xs font-bold text-status-bad-600">{r.count}x</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {data.cancellations.topItems.length > 0 && (
                  <div>
                    <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-2">{t("dashboard.analytics.mostCancelledItems")}</p>
                    <div className="space-y-1">
                      {data.cancellations.topItems.map((it) => (
                        <div key={it.name} className="flex items-center justify-between p-2 rounded-lg bg-status-bad-50 border border-status-bad-100">
                          <span className="text-xs text-status-bad-700">{it.name}</span>
                          <div className="flex gap-2">
                            <span className="text-[10px] text-status-bad-500">{it.qty}x</span>
                            <span className="text-xs font-bold text-status-bad-600">{formatEGP(it.revenue)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Staff quality */}
          <div className="card-luxury p-4">
            <div className="flex items-baseline justify-between mb-3">
              <h4 className="text-xs font-semibold text-text-primary uppercase tracking-wider">{t("dashboard.analytics.waiterLeaderboard")}</h4>
              <span className="text-[9px] text-text-muted">{t("dashboard.analytics.rankedBySpeed")}</span>
            </div>
            {data.staffQuality.length === 0 ? (
              <p className="text-xs text-text-muted py-6 text-center">
                {t("dashboard.analytics.noQualityData")}
              </p>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_repeat(3,minmax(0,1fr))] gap-2 text-[9px] font-bold text-text-muted uppercase tracking-wider px-2">
                  <span>{t("dashboard.analytics.waiter")}</span>
                  <span className="text-right">{t("dashboard.analytics.serveTime")}</span>
                  <span className="text-right">{t("dashboard.analytics.ordersHeader")}</span>
                  <span className="text-right">{t("dashboard.analytics.tablesHeader")}</span>
                </div>
                {data.staffQuality.map((s, i) => (
                  <div
                    key={s.id}
                    className="grid grid-cols-[1fr_repeat(3,minmax(0,1fr))] gap-2 items-center p-2 rounded-xl bg-sand-50 border border-sand-200"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold shrink-0 ${
                        i === 0 ? "bg-sunset-100 text-sunset-700" :
                        i === 1 ? "bg-sand-200 text-text-secondary" :
                        i === 2 ? "bg-ocean-100 text-ocean-700" :
                        "bg-sand-100 text-text-muted"
                      }`}>{i + 1}</span>
                      <span className="text-xs font-bold text-text-primary truncate">{s.name}</span>
                    </div>
                    <div className="text-right">
                      <p className={`text-xs font-semibold tabular-nums ${
                        s.avgServeFromReadyMin == null ? "text-text-muted" :
                        s.avgServeFromReadyMin <= 3 ? "text-success" :
                        s.avgServeFromReadyMin <= 6 ? "text-text-primary" :
                        "text-coral-600"
                      }`}>
                        {s.avgServeFromReadyMin == null ? "—" : `${s.avgServeFromReadyMin}m`}
                      </p>
                      <p className="text-[8px] text-text-muted">{t("dashboard.analytics.samples").replace("{count}", String(s.serveSamples))}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-bold text-text-secondary tabular-nums">{s.ordersHandled}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-bold text-text-secondary tabular-nums">{s.tablesHandled}</p>
                    </div>
                  </div>
                ))}
                <p className="text-[9px] text-text-muted mt-2 leading-relaxed">
                  <span className="font-bold">{t("dashboard.analytics.serveTimeExplain")}</span> {t("dashboard.analytics.serveTimeDesc")}
                </p>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function RevenueBars({ data, period }: { data: { t: number; revenue: number; orders: number }[]; period: "day" | "week" | "month" }) {
  const { t: translate } = useLanguage();
  const max = Math.max(1, ...data.map((d) => d.revenue));
  const labelFor = (t: number, i: number) => {
    const d = new Date(t);
    if (period === "day") return i % 4 === 0 ? `${d.getHours()}h` : "";
    if (period === "week") return d.toLocaleDateString("en-US", { weekday: "short" });
    return i % 5 === 0 ? `${d.getDate()}` : "";
  };
  return (
    <div>
      <div className="flex items-end gap-0.5 h-32">
        {data.map((b, i) => {
          const h = (b.revenue / max) * 100;
          return (
            <div key={b.t} className="flex-1 flex flex-col items-center justify-end group relative">
              <div
                className={`w-full rounded-t-sm transition-all ${b.revenue > 0 ? "bg-ocean-500 hover:bg-ocean-600" : "bg-sand-200"}`}
                style={{ height: `${h}%`, minHeight: b.revenue > 0 ? 2 : 1 }}
                title={`${formatEGP(b.revenue)} ${translate("common.egp")} · ${b.orders} ${translate("common.orders")}`}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-0.5 mt-1">
        {data.map((b, i) => (
          <div key={b.t} className="flex-1 text-center text-[8px] text-text-muted font-semibold">
            {labelFor(b.t, i)}
          </div>
        ))}
      </div>
    </div>
  );
}

function HourHeatmap({ data }: { data: { hour: number; revenue: number; orders: number }[] }) {
  const { t } = useLanguage();
  const max = Math.max(1, ...data.map((d) => d.revenue));
  const intensity = (v: number) => {
    if (v === 0) return 0;
    return Math.max(0.15, v / max);
  };
  return (
    <div>
      <div className="grid grid-cols-12 gap-0.5">
        {data.map((h) => (
          <div
            key={h.hour}
            className="aspect-square rounded-sm border border-sand-200"
            style={{
              backgroundColor: h.revenue > 0 ? `rgba(14, 165, 233, ${intensity(h.revenue)})` : "transparent",
            }}
            title={`${h.hour}:00 — ${formatEGP(h.revenue)} ${t("common.egp")}, ${h.orders} ${t("common.orders")}`}
          />
        ))}
      </div>
      <div className="grid grid-cols-12 gap-0.5 mt-1">
        {data.map((h) => (
          <div key={h.hour} className="text-center text-[7px] text-text-muted font-semibold">
            {h.hour % 3 === 0 ? h.hour : ""}
          </div>
        ))}
      </div>
      <p className="text-[9px] text-text-muted mt-2">{t("dashboard.analytics.heatmapCaption")}</p>
    </div>
  );
}

function PaymentMix({ paymentMix, totalRevenue }: { paymentMix: Record<string, { count: number; revenue: number }>; totalRevenue: number }) {
  const { t } = useLanguage();
  const entries = Object.entries(paymentMix).sort((a, b) => b[1].revenue - a[1].revenue);
  if (entries.length === 0) {
    return <p className="text-xs text-text-muted py-6 text-center">{t("dashboard.analytics.noPayments")}</p>;
  }
  const colors: Record<string, string> = {
    CASH: "bg-status-good-500",
    CARD: "bg-ocean-500",
    INSTAPAY: "bg-sunset-500",
    APPLE_PAY: "bg-sand-700",
    GOOGLE_PAY: "bg-coral-500",
    UNKNOWN: "bg-sand-300",
  };
  return (
    <div className="space-y-2">
      <div className="h-3 flex rounded-full overflow-hidden bg-sand-100">
        {entries.map(([method, v]) => {
          const pct = totalRevenue > 0 ? (v.revenue / totalRevenue) * 100 : 0;
          return (
            <div
              key={method}
              className={colors[method] || "bg-sand-400"}
              style={{ width: `${pct}%` }}
              title={`${method}: ${formatEGP(v.revenue)} ${t("common.egp")}`}
            />
          );
        })}
      </div>
      <div className="space-y-1">
        {entries.map(([method, v]) => {
          const pct = totalRevenue > 0 ? Math.round((v.revenue / totalRevenue) * 100) : 0;
          return (
            <div key={method} className="flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${colors[method] || "bg-sand-400"}`} />
                <span className="font-bold text-text-secondary">{method.replace("_", " ")}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-text-muted tabular-nums">{v.count}</span>
                <span className="text-success font-bold tabular-nums w-16 text-right">{formatEGP(v.revenue)}</span>
                <span className="text-text-muted tabular-nums w-8 text-right">{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PerformanceLadder({ restaurantId, ownerId }: { restaurantId: string; ownerId: string | null }) {
  const { t } = useLanguage();
  const [period, setPeriod] = useState<"day" | "week" | "month">("day");
  const [waiters, setWaiters] = useState<WaiterPerf[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    ownerFetch(ownerId, `/api/staff/performance?restaurantId=${restaurantId}&period=${period}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setWaiters(data.waiters || []);
        setLoading(false);
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [restaurantId, period]);

  const topScore = waiters.length > 0 ? waiters[0].performanceScore : 1;

  return (
    <div className="space-y-4">
      {/* Header + Period tabs */}
      <div className="card-luxury p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-text-primary font-bold text-sm flex items-center gap-2">
            {t("dashboard.staffPerformance")}
            <span className="text-[10px] text-text-muted font-normal ml-1">{t("dashboard.rankedByEfficiency")}</span>
          </h3>
        </div>
        <div className="flex gap-2">
          {(["day", "week", "month"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`flex-1 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                period === p ? "bg-ocean-500 text-white shadow-md" : "bg-sand-100 text-text-muted hover:bg-sand-200"
              }`}
            >
              {p === "day" ? t("common.today") : p === "week" ? t("dashboard.analytics.week") : t("dashboard.analytics.month")}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="card-luxury p-12 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-ocean-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : waiters.length === 0 ? (
        <div className="card-luxury p-12 text-center">
          <p className="text-text-muted text-sm">{t("dashboard.noDataFor").replace("{period}", period === "day" ? t("common.today").toLowerCase() : period === "week" ? t("dashboard.analytics.week").toLowerCase() : t("dashboard.analytics.month").toLowerCase())}</p>
        </div>
      ) : (
        <>
          {/* Top 3 podium — score-based */}
          {waiters.length >= 1 && (
            <div className="card-luxury p-5">
              <div className="flex items-end justify-center gap-3">
                {[1, 0, 2].map((rank) => {
                  const w = waiters[rank];
                  if (!w) return <div key={rank} className="w-16" />;
                  const isFirst = rank === 0;
                  const heights = ["h-28", "h-20", "h-16"];
                  const widths = ["w-20", "w-16", "w-16"];
                  const gradients = [
                    "from-ocean-200 to-ocean-50 border-2 border-ocean-300 shadow-md",
                    "from-sand-200 to-sand-100 border border-sand-200",
                    "from-sunset-200/50 to-sunset-100/30 border border-sunset-200",
                  ];
                  const textColors = ["text-ocean-700", "text-text-secondary", "text-sunset-600"];
                  return (
                    <div key={rank} className="flex flex-col items-center">
                      <span className={`${isFirst ? "text-3xl" : "text-2xl"} mb-1`}>{RANK_MEDALS[rank]}</span>
                      <div className={`${widths[rank]} ${heights[rank]} rounded-t-xl bg-gradient-to-t ${gradients[rank]} border-b-0 flex flex-col items-center justify-end pb-2 gap-0.5`}>
                        <span className={`text-[10px] font-semibold ${textColors[rank]}`}>{w.performanceScore}pts</span>
                        {w.avgServingMinutes > 0 && <span className="text-[8px] text-text-muted">{w.avgServingMinutes}m avg</span>}
                      </div>
                      <div className={`${widths[rank]} py-1.5 ${rank === 0 ? "bg-ocean-50 border-2 border-t-0 border-ocean-300 shadow-md" : rank === 1 ? "bg-sand-100 border border-t-0 border-sand-200" : "bg-sunset-50 border border-t-0 border-sunset-200"} rounded-b-lg text-center`}>
                        <p className="text-[10px] font-bold text-text-primary truncate px-1">{w.name}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Rankings list */}
          <div className="card-luxury p-5">
            <h4 className="text-text-primary font-bold text-sm mb-3">{t("dashboard.rankings")}</h4>
            <div className="space-y-2">
              {waiters.map((w, i) => {
                const barWidth = topScore > 0 ? Math.max(5, (w.performanceScore / topScore) * 100) : 5;
                const isExpanded = expanded === w.id;
                return (
                  <motion.div
                    key={w.id}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="rounded-xl bg-sand-50 border border-sand-200 overflow-hidden cursor-pointer"
                    onClick={() => setExpanded(isExpanded ? null : w.id)}
                  >
                    <div className="relative p-3">
                      <div
                        className={`absolute inset-y-0 left-0 ${i === 0 ? "bg-ocean-100/60" : i === 1 ? "bg-sand-200/40" : i === 2 ? "bg-sunset-100/40" : "bg-sand-100/30"} transition-all duration-700`}
                        style={{ width: `${barWidth}%` }}
                      />
                      <div className="relative flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-semibold text-sm ${
                          i === 0 ? "bg-ocean-100 text-ocean-700 border border-ocean-200" :
                          i === 1 ? "bg-sand-200 text-sand-700 border border-sand-300" :
                          i === 2 ? "bg-sunset-100 text-sunset-600 border border-sunset-200" :
                          "bg-white text-text-muted border border-sand-200"
                        }`}>
                          {i < 3 ? RANK_MEDALS[i] : `#${i + 1}`}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-text-primary truncate">{w.name}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            <span className={`w-1.5 h-1.5 rounded-full ${w.active ? "bg-success" : "bg-sand-300"}`} />
                            <span className="text-[9px] text-text-muted font-semibold">
                              {w.avgServingMinutes > 0 ? `${w.avgServingMinutes}m serve` : "—"} · {w.tablesPerHour > 0 ? `${w.tablesPerHour} tbl/hr` : "—"} · {w.ordersHandled} orders
                            </span>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className={`text-sm font-semibold tabular-nums ${i === 0 ? "text-ocean-600" : "text-text-primary"}`}>
                            {w.performanceScore} <span className="text-[9px] text-text-muted">pts</span>
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Expanded detail */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="px-3 pb-3 border-t border-sand-200">
                            <div className="grid grid-cols-4 gap-2 mt-3">
                              <div className="text-center p-2 rounded-lg bg-status-wait-50 border border-status-wait-100">
                                <p className="text-sm font-semibold text-status-wait-700">{w.avgServingMinutes || "—"}<span className="text-[8px]">m</span></p>
                                <p className="text-[8px] text-status-wait-500 font-bold">AVG SERVE</p>
                              </div>
                              <div className="text-center p-2 rounded-lg bg-status-warn-50 border border-status-warn-100">
                                <p className="text-sm font-semibold text-status-warn-700">{w.avgTurnaroundMinutes || "—"}<span className="text-[8px]">m</span></p>
                                <p className="text-[8px] text-status-warn-500 font-bold">TURNAROUND</p>
                              </div>
                              <div className="text-center p-2 rounded-lg bg-status-good-50 border border-status-good-100">
                                <p className="text-sm font-semibold text-status-good-700">{w.tablesPerHour || "—"}</p>
                                <p className="text-[8px] text-status-good-500 font-bold">TBL/HOUR</p>
                              </div>
                              <div className="text-center p-2 rounded-lg bg-ocean-50 border border-ocean-100">
                                <p className="text-sm font-semibold text-ocean-700">{w.closedSessions}</p>
                                <p className="text-[8px] text-ocean-500 font-bold">COMPLETED</p>
                              </div>
                            </div>
                            <div className="grid grid-cols-3 gap-2 mt-2">
                              <div className="text-center p-2 rounded-lg bg-sand-100 border border-sand-200">
                                <p className="text-sm font-semibold text-text-primary">{formatEGP(w.totalRevenue)}</p>
                                <p className="text-[8px] text-text-muted font-bold">REVENUE</p>
                              </div>
                              <div className="text-center p-2 rounded-lg bg-sand-100 border border-sand-200">
                                <p className="text-sm font-semibold text-text-primary">{w.ordersHandled}</p>
                                <p className="text-[8px] text-text-muted font-bold">ORDERS</p>
                              </div>
                              <div className="text-center p-2 rounded-lg bg-sand-100 border border-sand-200">
                                <p className="text-sm font-semibold text-text-primary">{w.itemsServed}</p>
                                <p className="text-[8px] text-text-muted font-bold">ITEMS</p>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Send message helper ─────────────────────────

function sendOwnerMessage(msg: { type: "alert" | "command"; to?: string; text: string; tableId?: number; orderId?: string; command?: string }, ownerId?: string | null) {
  const restaurantId = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";
  ownerFetch(ownerId ?? null, "/api/messages", { method: "POST", body: JSON.stringify({ from: "owner", restaurantId, ...msg }) }).catch((err) => console.error("Failed to send message:", err));
}

// ═════════════════════════════════════════════════
// VIP MANAGEMENT
// ═════════════════════════════════════════════════

type VipGuest = {
  id: string;
  name: string;
  phone: string;
  address: string | null;
  addressNotes: string | null;
  linkToken: string;
  active: boolean;
  createdAt: string;
};

function VipPanel({ restaurantSlug, ownerId }: { restaurantSlug: string; ownerId: string | null }) {
  const { t } = useLanguage();
  const [guests, setGuests] = useState<VipGuest[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const fetchGuests = useCallback(async () => {
    try {
      const res = await ownerFetch(ownerId, `/api/vip?restaurantId=${restaurantSlug}`);
      if (res.ok) setGuests(await res.json());
    } catch {}
    setLoading(false);
  }, [restaurantSlug]);

  useEffect(() => { fetchGuests(); }, [fetchGuests]);

  const handleCreate = async () => {
    if (!name.trim() || !phone.trim()) { setError(t("dashboard.vip.nameAndPhoneRequired")); return; }
    setError("");
    try {
      const res = await ownerFetch(ownerId, "/api/vip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, address: address || null, restaurantId: restaurantSlug }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to create");
        return;
      }
      setName(""); setPhone(""); setAddress(""); setCreating(false);
      fetchGuests();
    } catch { setError("Network error"); }
  };

  const toggleActive = async (guest: VipGuest) => {
    await ownerFetch(ownerId, "/api/vip", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: guest.id, active: !guest.active }),
    });
    fetchGuests();
  };

  const copyLink = (guest: VipGuest) => {
    const url = `${window.location.origin}/vip/${guest.linkToken}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(guest.id);
      setTimeout(() => setCopied(null), 2000);
    });
  };

  const startEdit = (g: VipGuest) => {
    setEditingId(g.id);
    setEditName(g.name);
    setEditPhone(g.phone);
    setEditAddress(g.address || "");
    setEditNotes(g.addressNotes || "");
  };

  const handleSaveEdit = async () => {
    if (!editingId || !editName.trim() || !editPhone.trim()) return;
    setSaving(true);
    try {
      await ownerFetch(ownerId, "/api/vip", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, name: editName, phone: editPhone, address: editAddress || null, addressNotes: editNotes || null }),
      });
      setEditingId(null);
      fetchGuests();
    } catch {}
    setSaving(false);
  };

  const handleDelete = async (guest: VipGuest) => {
    setDeleting(guest.id);
  };

  const confirmDelete = async (id: string) => {
    try {
      await ownerFetch(ownerId, "/api/vip", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, delete: true }),
      });
      setDeleting(null);
      fetchGuests();
    } catch {}
  };

  const activeGuests = guests.filter((g) => g.active);
  const inactiveGuests = guests.filter((g) => !g.active);

  return (
    <div className="space-y-4">
      <div className="card-luxury p-5">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-text-primary font-bold text-lg">{t("dashboard.vip.title")}</h3>
          <button onClick={() => setCreating(true)} className="btn-primary !text-sm !px-4 !py-2">{t("dashboard.vip.newVip")}</button>
        </div>
        <p className="text-text-muted text-sm">{activeGuests.length} active VIP guest{activeGuests.length !== 1 ? "s" : ""}</p>
      </div>

      <AnimatePresence>
        {creating && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="card-luxury p-5">
              <h4 className="text-text-primary font-bold text-sm mb-4">{t("dashboard.vip.createVip")}</h4>
              <div className="space-y-3">
                <div>
                  <label className="text-[10px] text-text-muted font-semibold uppercase tracking-wider block mb-1.5">Name</label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ahmed Hassan" className="w-full px-4 py-2.5 rounded-xl bg-sand-50 border border-sand-200 text-text-primary text-sm focus:outline-none focus:border-ocean-400 transition" />
                </div>
                <div>
                  <label className="text-[10px] text-text-muted font-semibold uppercase tracking-wider block mb-1.5">Phone</label>
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="e.g. 01012345678" className="w-full px-4 py-2.5 rounded-xl bg-sand-50 border border-sand-200 text-text-primary text-sm focus:outline-none focus:border-ocean-400 transition" />
                </div>
                <div>
                  <label className="text-[10px] text-text-muted font-semibold uppercase tracking-wider block mb-1.5">{t("dashboard.vip.defaultAddress")}</label>
                  <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="e.g. 15 Mashraba St, Dahab" className="w-full px-4 py-2.5 rounded-xl bg-sand-50 border border-sand-200 text-text-primary text-sm focus:outline-none focus:border-ocean-400 transition" />
                </div>
                {error && <p className="text-coral-600 text-xs font-medium">{error}</p>}
                <div className="flex gap-2 pt-1">
                  <button onClick={handleCreate} className="flex-1 btn-primary text-center">{t("dashboard.vip.createVipBtn")}</button>
                  <button onClick={() => { setCreating(false); setError(""); }} className="px-6 py-3 rounded-xl bg-sand-100 border border-sand-200 text-text-secondary font-bold text-sm">{t("common.cancel")}</button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-6 h-6 border-2 border-ocean-400 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <>
          {activeGuests.map((g) => (
            <div key={g.id} className="card-luxury p-4">
              {editingId === g.id ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-text-muted font-semibold uppercase tracking-wider block mb-1">Name</label>
                      <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-sand-50 border border-sand-200 text-text-primary text-sm focus:outline-none focus:border-ocean-400" />
                    </div>
                    <div>
                      <label className="text-[10px] text-text-muted font-semibold uppercase tracking-wider block mb-1">Phone</label>
                      <input type="tel" value={editPhone} onChange={(e) => setEditPhone(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-sand-50 border border-sand-200 text-text-primary text-sm focus:outline-none focus:border-ocean-400" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] text-text-muted font-semibold uppercase tracking-wider block mb-1">Address</label>
                    <input type="text" value={editAddress} onChange={(e) => setEditAddress(e.target.value)} className="w-full px-3 py-2 rounded-xl bg-sand-50 border border-sand-200 text-text-primary text-sm focus:outline-none focus:border-ocean-400" />
                  </div>
                  <div>
                    <label className="text-[10px] text-text-muted font-semibold uppercase tracking-wider block mb-1">{t("dashboard.vip.addressNotes")}</label>
                    <input type="text" value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="e.g. Blue gate, 2nd floor" className="w-full px-3 py-2 rounded-xl bg-sand-50 border border-sand-200 text-text-primary text-sm focus:outline-none focus:border-ocean-400" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={handleSaveEdit} disabled={saving} className="flex-1 btn-primary !text-sm !py-2 text-center">{saving ? t("dashboard.saving") : t("common.save")}</button>
                    <button onClick={() => setEditingId(null)} className="px-4 py-2 rounded-xl bg-sand-100 border border-sand-200 text-text-secondary font-bold text-sm">{t("common.cancel")}</button>
                  </div>
                </div>
              ) : deleting === g.id ? (
                <div className="flex items-center justify-between">
                  <p className="text-sm text-status-bad-600 font-bold">{t("dashboard.vip.deleteConfirm").replace("{name}", g.name)}</p>
                  <div className="flex items-center gap-2">
                    <button onClick={() => confirmDelete(g.id)} className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-status-bad-600 text-white">{t("dashboard.vip.yesDelete")}</button>
                    <button onClick={() => setDeleting(null)} className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-sand-100 border border-sand-200 text-text-secondary">{t("common.cancel")}</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-text-primary font-bold text-sm">{g.name}</h4>
                    <p className="text-text-muted text-xs">{g.phone}{g.address ? ` · ${g.address}` : ""}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => copyLink(g)}
                      className={`text-[10px] font-bold px-3 py-1.5 rounded-lg border transition ${
                        copied === g.id ? "bg-status-good-50 border-status-good-200 text-status-good-600" : "bg-sand-50 border-sand-200 text-text-secondary hover:border-ocean-400"
                      }`}
                    >
                      {copied === g.id ? t("dashboard.vip.copied") : t("dashboard.vip.copyLink")}
                    </button>
                    <button onClick={() => startEdit(g)} className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-sand-50 border border-sand-200 text-text-secondary hover:border-ocean-400">
                      {t("dashboard.vip.edit")}
                    </button>
                    <button onClick={() => handleDelete(g)} className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-status-bad-50 border border-status-bad-200 text-status-bad-500">
                      {t("common.delete")}
                    </button>
                    <button onClick={() => toggleActive(g)} className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-status-warn-50 border border-status-warn-200 text-status-warn-600">
                      {t("dashboard.deactivate")}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}

          {inactiveGuests.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-[11px] font-semibold uppercase tracking-wider text-text-muted px-1">{t("dashboard.vip.inactive")}</h4>
              {inactiveGuests.map((g) => (
                <div key={g.id} className="card-luxury p-4 opacity-60">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-text-secondary font-bold text-sm">{g.name}</h4>
                      <p className="text-text-muted text-xs">{g.phone}</p>
                    </div>
                    <button onClick={() => toggleActive(g)} className="text-[10px] font-bold px-3 py-1.5 rounded-lg bg-status-good-50 border border-status-good-200 text-status-good-600">
                      {t("dashboard.reactivate")}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {guests.length === 0 && (
            <div className="card-luxury p-8 text-center">
              <p className="text-text-muted text-sm">{t("dashboard.vip.noVipYet")}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════
// SCHEDULE PANEL
// ═════════════════════════════════════════════════

type ScheduleStaff = { id: string; name: string; role: string; active: boolean };

function SchedulePanel({ staff, restaurantSlug, onRefresh, ownerId }: { staff: ScheduleStaff[]; restaurantSlug: string; onRefresh?: () => void; ownerId?: string | null }) {
  const { t } = useLanguage();
  const [month, setMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [schedules, setSchedules] = useState<Record<string, number>>({});
  const [roleFilter, setRoleFilter] = useState("ALL");
  const [loading, setLoading] = useState(false);

  const fetchSchedules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/schedule?restaurantId=${restaurantSlug}&year=${month.year}&month=${month.month + 1}`);
      if (!res.ok) return;
      const data = await res.json();
      const map: Record<string, number> = {};
      for (const s of data) {
        const dateStr = typeof s.date === "string" ? s.date.slice(0, 10) : new Date(s.date).toISOString().slice(0, 10);
        map[`${s.staffId}-${dateStr}`] = s.shift;
      }
      setSchedules(map);
    } catch { /* silent */ }
    setLoading(false);
  }, [restaurantSlug, month]);

  useEffect(() => { fetchSchedules(); }, [fetchSchedules]);

  const daysInMonth = new Date(month.year, month.month + 1, 0).getDate();
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const cairoNow = nowInRestaurantTz();
  const todayStr = `${cairoNow.getFullYear()}-${String(cairoNow.getMonth() + 1).padStart(2, "0")}-${String(cairoNow.getDate()).padStart(2, "0")}`;

  const filteredStaff = staff
    .filter((s) => s.role !== "OWNER" && s.role !== "DELIVERY")
    .filter((s) => roleFilter === "ALL" || s.role === roleFilter)
    .sort((a, b) => a.name.localeCompare(b.name));

  const [fillMenu, setFillMenu] = useState<string | null>(null);

  const SHIFT_BG = ["", "bg-status-info-100 text-status-info-700", "bg-status-warn-100 text-status-warn-700", "bg-status-good-100 text-status-good-700"];
  const monthLabel = new Date(month.year, month.month).toLocaleString("en", { month: "long", year: "numeric" });

  const handleClick = async (staffId: string, dateStr: string, role: string) => {
    const key = `${staffId}-${dateStr}`;
    const current = schedules[key] || 0;
    const max = getShiftCount(role);
    const next = current >= max ? 0 : current + 1;

    setSchedules((prev) => {
      const n = { ...prev };
      if (next === 0) delete n[key]; else n[key] = next;
      return n;
    });

    if (next === 0) {
      ownerFetch(ownerId ?? null, "/api/schedule", { method: "DELETE", body: JSON.stringify({ staffId, date: dateStr, restaurantId: restaurantSlug }) }).catch(() => {});
    } else {
      ownerFetch(ownerId ?? null, "/api/schedule", { method: "POST", body: JSON.stringify({ staffId, date: dateStr, shift: next, restaurantId: restaurantSlug }) }).catch(() => {});
    }

    if (dateStr === todayStr) {
      fetch("/api/staff", { method: "PATCH", headers: { "Content-Type": "application/json", ...(ownerId ? { "x-staff-id": ownerId } : {}) }, body: JSON.stringify({ id: staffId, shift: next }) }).then(() => onRefresh?.()).catch(() => {});
    }
  };

  const fillMonth = async (staffId: string, shift: number, role: string) => {
    setFillMenu(null);
    const updates: Record<string, number> = {};
    const promises: Promise<unknown>[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${month.year}-${String(month.month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const key = `${staffId}-${dateStr}`;
      updates[key] = shift;
      promises.push(
        ownerFetch(ownerId ?? null, "/api/schedule", {
          method: "POST",
          body: JSON.stringify({ staffId, date: dateStr, shift, restaurantId: restaurantSlug }),
        }).catch(() => {})
      );
      if (dateStr === todayStr) {
        promises.push(
          fetch("/api/staff", {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...(ownerId ? { "x-staff-id": ownerId } : {}) },
            body: JSON.stringify({ id: staffId, shift }),
          }).then(() => onRefresh?.()).catch(() => {})
        );
      }
    }
    setSchedules((prev) => ({ ...prev, ...updates }));
    await Promise.all(promises);
  };

  const clearMonth = async (staffId: string) => {
    setFillMenu(null);
    const removals: string[] = [];
    const promises: Promise<unknown>[] = [];
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${month.year}-${String(month.month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const key = `${staffId}-${dateStr}`;
      removals.push(key);
      promises.push(
        ownerFetch(ownerId ?? null, "/api/schedule", {
          method: "DELETE",
          body: JSON.stringify({ staffId, date: dateStr, restaurantId: restaurantSlug }),
        }).catch(() => {})
      );
      if (dateStr === todayStr) {
        promises.push(
          fetch("/api/staff", {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...(ownerId ? { "x-staff-id": ownerId } : {}) },
            body: JSON.stringify({ id: staffId, shift: 0 }),
          }).then(() => onRefresh?.()).catch(() => {})
        );
      }
    }
    setSchedules((prev) => {
      const n = { ...prev };
      for (const k of removals) delete n[k];
      return n;
    });
    await Promise.all(promises);
  };

  const prevMonth = () => setMonth((p) => p.month === 0 ? { year: p.year - 1, month: 11 } : { year: p.year, month: p.month - 1 });
  const nextMonth = () => setMonth((p) => p.month === 11 ? { year: p.year + 1, month: 0 } : { year: p.year, month: p.month + 1 });

  const roles = ["ALL", "WAITER", "KITCHEN", "BAR", "CASHIER", "FLOOR_MANAGER"];

  return (
    <div className="space-y-4">
      <div className="card-luxury p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <button onClick={prevMonth} className="w-8 h-8 rounded-lg bg-sand-100 hover:bg-sand-200 flex items-center justify-center text-sm font-bold transition">◀</button>
            <h3 className="text-text-primary font-semibold text-sm min-w-[160px] text-center">{monthLabel}</h3>
            <button onClick={nextMonth} className="w-8 h-8 rounded-lg bg-sand-100 hover:bg-sand-200 flex items-center justify-center text-sm font-bold transition">▶</button>
          </div>
          <div className="flex gap-1 flex-wrap">
            {roles.map((r) => (
              <button key={r} onClick={() => setRoleFilter(r)} className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition border ${roleFilter === r ? "bg-ocean-50 text-ocean-600 border-ocean-200" : "bg-white text-text-muted border-sand-200 hover:bg-sand-50"}`}>
                {r === "ALL" ? t("dashboard.schedule.all") : r === "FLOOR_MANAGER" ? t("dashboard.schedule.floorMgr") : r.charAt(0) + r.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        {loading && <p className="text-xs text-text-muted text-center py-4">{t("dashboard.schedule.loading")}</p>}

        <div className="overflow-x-auto" onClick={() => fillMenu && setFillMenu(null)}>
          <table className="w-full text-[10px]">
            <thead>
              <tr>
                <th className="sticky left-0 bg-white z-10 text-left px-2 py-1.5 text-text-muted font-bold min-w-[100px]">{t("dashboard.schedule.staff")}</th>
                {days.map((d) => {
                  const dateStr = `${month.year}-${String(month.month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                  const dow = new Date(month.year, month.month, d).getDay();
                  const isWeekend = dow === 5 || dow === 6;
                  const isToday = dateStr === todayStr;
                  return (
                    <th key={d} className={`px-0.5 py-1.5 text-center min-w-[32px] ${isWeekend ? "bg-sand-50" : ""} ${isToday ? "bg-ocean-50" : ""}`}>
                      <div className="text-[8px] text-text-muted">{["Su","Mo","Tu","We","Th","Fr","Sa"][dow]}</div>
                      <div className={`font-semibold ${isToday ? "text-ocean-600" : "text-text-secondary"}`}>{d}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {filteredStaff.map((s) => (
                <tr key={s.id} className="border-t border-sand-100">
                  <td className="sticky left-0 bg-white z-10 px-2 py-1.5">
                    <div className="flex items-center gap-1">
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-text-primary truncate max-w-[80px]">{s.name}</div>
                        <div className="text-[8px] text-text-muted">{s.role === "FLOOR_MANAGER" ? "FLOOR MGR" : s.role}</div>
                      </div>
                      <div className="relative">
                        <button
                          onClick={() => setFillMenu(fillMenu === s.id ? null : s.id)}
                          className="w-5 h-5 rounded bg-sand-100 hover:bg-ocean-100 flex items-center justify-center text-[8px] font-bold text-text-muted hover:text-ocean-600 transition"
                          title={t("dashboard.schedule.fillMonth")}
                        >
                          ▼
                        </button>
                        {fillMenu === s.id && (
                          <div className="absolute left-0 top-6 z-20 bg-white border border-sand-200 rounded-lg shadow-lg py-1 min-w-[90px]">
                            {Array.from({ length: getShiftCount(s.role) }, (_, i) => i + 1).map((shift) => (
                              <button
                                key={shift}
                                onClick={() => fillMonth(s.id, shift, s.role)}
                                className={`w-full px-3 py-1.5 text-left text-[10px] font-bold hover:bg-sand-50 transition flex items-center gap-2 ${SHIFT_BG[shift]}`}
                              >
                                <span className="w-3 h-3 rounded inline-block" /> {t("dashboard.schedule.fillShift").replace("{n}", String(shift))}
                              </button>
                            ))}
                            <button
                              onClick={() => clearMonth(s.id)}
                              className="w-full px-3 py-1.5 text-left text-[10px] font-bold text-status-bad-500 hover:bg-status-bad-50 transition"
                            >
                              {t("dashboard.schedule.clearAll")}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  {days.map((d) => {
                    const dateStr = `${month.year}-${String(month.month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
                    const key = `${s.id}-${dateStr}`;
                    const shift = schedules[key] || 0;
                    const dow = new Date(month.year, month.month, d).getDay();
                    const isWeekend = dow === 5 || dow === 6;
                    const isToday = dateStr === todayStr;
                    return (
                      <td key={d} className={`px-0.5 py-1 text-center ${isWeekend ? "bg-sand-50/50" : ""} ${isToday ? "bg-ocean-50/30" : ""}`}>
                        <button
                          onClick={() => handleClick(s.id, dateStr, s.role)}
                          className={`w-7 h-7 rounded-md text-[9px] font-semibold transition hover:ring-2 hover:ring-ocean-300 ${shift ? SHIFT_BG[shift] : "bg-sand-50 text-sand-300 hover:bg-sand-100"}`}
                        >
                          {shift ? `S${shift}` : "·"}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
              {filteredStaff.length === 0 && (
                <tr><td colSpan={daysInMonth + 1} className="text-center py-8 text-text-muted text-xs">{t("dashboard.schedule.noStaff")}</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex gap-4 mt-4 text-[9px] text-text-muted justify-center">
          <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-status-info-100 inline-block" /> S1</span>
          <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-status-warn-100 inline-block" /> S2</span>
          <span className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-status-good-100 inline-block" /> S3</span>
          <span className="text-[8px]">{t("dashboard.schedule.clickCycle")}</span>
        </div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════
// BOOKS PANEL — daily close + CSV export + clock log
// ═════════════════════════════════════════════════

type DailyCloseRow = {
  id: string;
  date: string;
  closedAt: string;
  closedByName: string | null;
  notes: string | null;
  totals: {
    revenue: number;
    orders: number;
    sessions: number;
    cash: number;
    card: number;
    instapay: number;
    otherPay: number;
    compedValue: number;
    compedCount: number;
    cancelledValue: number;
    cancelledCount: number;
    byWaiter: { waiterId: string; name: string; revenue: number; orders: number; cash: number; card: number }[];
  };
};

// Cairo-local YYYY-MM-DD for the *current* business day (rolls back to
// yesterday if it's before 6am local — matches the daily-close default).
function cairoBusinessDayISO(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const hourFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Cairo",
    hour: "2-digit",
    hour12: false,
  });
  const hour = parseInt(hourFmt.format(new Date()), 10);
  const base = fmt.format(new Date()); // YYYY-MM-DD (Cairo)
  if (hour >= 6) return base;
  const d = new Date(base + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function BooksPanel({ restaurantSlug, ownerId }: { restaurantSlug: string; ownerId: string | null }) {
  const { t } = useLanguage();
  const [closes, setCloses] = useState<DailyCloseRow[]>([]);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [closeDate, setCloseDate] = useState<string>(() => cairoBusinessDayISO());
  const [exportFrom, setExportFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [exportTo, setExportTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [exporting, setExporting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const printClose = (c: DailyCloseRow) => {
    const w = window.open("", "_blank", "width=800,height=900");
    if (!w) return;
    const waiterRows = c.totals.byWaiter.map((wt) =>
      `<tr><td>${wt.name}</td><td class="r">${wt.revenue.toLocaleString()}</td><td class="r">${wt.orders}</td><td class="r">${wt.cash.toLocaleString()}</td><td class="r">${wt.card.toLocaleString()}</td></tr>`
    ).join("");
    w.document.write(`<!DOCTYPE html><html><head><title>Daily Close ${c.date}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;font-family:system-ui,-apple-system,sans-serif}
  body{padding:40px;color:#1e293b}
  h1{font-size:20px;margin-bottom:4px}
  .sub{color:#64748b;font-size:13px;margin-bottom:24px}
  .grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:24px}
  .card{border:1px solid #e2e8f0;border-radius:10px;padding:14px}
  .card .label{font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700;letter-spacing:0.5px}
  .card .val{font-size:22px;font-weight:800;margin-top:2px}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
  th{text-align:left;border-bottom:2px solid #e2e8f0;padding:6px 8px;font-size:11px;text-transform:uppercase;color:#64748b}
  td{padding:6px 8px;border-bottom:1px solid #f1f5f9}
  .r{text-align:right;font-variant-numeric:tabular-nums}
  h2{font-size:15px;font-weight:700;margin:24px 0 8px}
  .footer{margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center}
  @media print{body{padding:20px}@page{margin:15mm}}
</style></head><body>
<h1>Daily Close Report — ${c.date}</h1>
<p class="sub">Closed by ${c.closedByName || "—"} at ${new Date(c.closedAt).toLocaleString()}</p>
<div class="grid">
  <div class="card"><div class="label">Revenue</div><div class="val">${c.totals.revenue.toLocaleString()} EGP</div></div>
  <div class="card"><div class="label">Orders</div><div class="val">${c.totals.orders}</div></div>
  <div class="card"><div class="label">Sessions</div><div class="val">${c.totals.sessions}</div></div>
  <div class="card"><div class="label">Cash</div><div class="val">${c.totals.cash.toLocaleString()}</div></div>
  <div class="card"><div class="label">Card</div><div class="val">${c.totals.card.toLocaleString()}</div></div>
  <div class="card"><div class="label">InstaPay</div><div class="val">${c.totals.instapay.toLocaleString()}</div></div>
  <div class="card"><div class="label">Comped</div><div class="val">${c.totals.compedValue.toLocaleString()} (${c.totals.compedCount})</div></div>
  <div class="card"><div class="label">Cancelled</div><div class="val">${c.totals.cancelledValue.toLocaleString()} (${c.totals.cancelledCount})</div></div>
  ${c.totals.otherPay ? `<div class="card"><div class="label">Other</div><div class="val">${c.totals.otherPay.toLocaleString()}</div></div>` : ""}
</div>
${c.totals.byWaiter.length > 0 ? `<h2>By Waiter</h2>
<table><thead><tr><th>Name</th><th class="r">Revenue</th><th class="r">Orders</th><th class="r">Cash</th><th class="r">Card</th></tr></thead><tbody>${waiterRows}</tbody></table>` : ""}
${c.notes ? `<h2>Notes</h2><p style="font-size:13px">${c.notes}</p>` : ""}
<div class="footer">Generated from Table-to-Cash</div>
</body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 300);
  };

  const printRange = () => {
    const closesInRange = closes.filter((c) => c.date >= exportFrom && c.date <= exportTo);
    if (closesInRange.length === 0) { alert(t("dashboard.books.noCloses")); return; }

    const totalRevenue = closesInRange.reduce((s, c) => s + c.totals.revenue, 0);
    const totalOrders = closesInRange.reduce((s, c) => s + c.totals.orders, 0);
    const totalSessions = closesInRange.reduce((s, c) => s + c.totals.sessions, 0);
    const totalCash = closesInRange.reduce((s, c) => s + c.totals.cash, 0);
    const totalCard = closesInRange.reduce((s, c) => s + c.totals.card, 0);
    const totalInstapay = closesInRange.reduce((s, c) => s + c.totals.instapay, 0);
    const totalComped = closesInRange.reduce((s, c) => s + c.totals.compedValue, 0);
    const totalCancelled = closesInRange.reduce((s, c) => s + c.totals.cancelledValue, 0);

    const dayRows = closesInRange.map((c) =>
      `<tr><td>${c.date}</td><td class="r">${c.totals.revenue.toLocaleString()}</td><td class="r">${c.totals.orders}</td><td class="r">${c.totals.cash.toLocaleString()}</td><td class="r">${c.totals.card.toLocaleString()}</td><td class="r">${c.totals.instapay.toLocaleString()}</td></tr>`
    ).join("");

    const w = window.open("", "_blank", "width=800,height=900");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><title>Report ${exportFrom} to ${exportTo}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box;font-family:system-ui,-apple-system,sans-serif}
  body{padding:40px;color:#1e293b}
  h1{font-size:20px;margin-bottom:4px}
  .sub{color:#64748b;font-size:13px;margin-bottom:24px}
  .grid{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-bottom:24px}
  .card{border:1px solid #e2e8f0;border-radius:10px;padding:14px}
  .card .label{font-size:11px;color:#94a3b8;text-transform:uppercase;font-weight:700;letter-spacing:0.5px}
  .card .val{font-size:22px;font-weight:800;margin-top:2px}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
  th{text-align:left;border-bottom:2px solid #e2e8f0;padding:6px 8px;font-size:11px;text-transform:uppercase;color:#64748b}
  td{padding:6px 8px;border-bottom:1px solid #f1f5f9}
  .r{text-align:right;font-variant-numeric:tabular-nums}
  .total td{font-weight:800;border-top:2px solid #1e293b}
  h2{font-size:15px;font-weight:700;margin:24px 0 8px}
  .footer{margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center}
  @media print{body{padding:20px}@page{margin:15mm}}
</style></head><body>
<h1>Period Report — ${exportFrom} to ${exportTo}</h1>
<p class="sub">${closesInRange.length} days</p>
<div class="grid">
  <div class="card"><div class="label">Total Revenue</div><div class="val">${totalRevenue.toLocaleString()} EGP</div></div>
  <div class="card"><div class="label">Total Orders</div><div class="val">${totalOrders.toLocaleString()}</div></div>
  <div class="card"><div class="label">Cash</div><div class="val">${totalCash.toLocaleString()}</div></div>
  <div class="card"><div class="label">Card</div><div class="val">${totalCard.toLocaleString()}</div></div>
  <div class="card"><div class="label">InstaPay</div><div class="val">${totalInstapay.toLocaleString()}</div></div>
  <div class="card"><div class="label">Sessions</div><div class="val">${totalSessions.toLocaleString()}</div></div>
  <div class="card"><div class="label">Comped</div><div class="val">${totalComped.toLocaleString()}</div></div>
  <div class="card"><div class="label">Cancelled</div><div class="val">${totalCancelled.toLocaleString()}</div></div>
</div>
<h2>Daily Breakdown</h2>
<table><thead><tr><th>Date</th><th class="r">Revenue</th><th class="r">Orders</th><th class="r">Cash</th><th class="r">Card</th><th class="r">InstaPay</th></tr></thead>
<tbody>${dayRows}
<tr class="total"><td>Total</td><td class="r">${totalRevenue.toLocaleString()}</td><td class="r">${totalOrders}</td><td class="r">${totalCash.toLocaleString()}</td><td class="r">${totalCard.toLocaleString()}</td><td class="r">${totalInstapay.toLocaleString()}</td></tr>
</tbody></table>
<div class="footer">Generated from Table-to-Cash</div>
</body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 300);
  };

  const refresh = useCallback(async () => {
    if (!ownerId) return;
    try {
      const res = await ownerFetch(ownerId, `/api/daily-close?restaurantId=${restaurantSlug}`);
      if (res.ok) {
        const data = await res.json();
        setCloses(data.closes || []);
      }
    } catch {}
  }, [restaurantSlug, ownerId]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleClose = async () => {
    if (!ownerId) { setCloseError(t("dashboard.books.ownerRequired")); return; }
    if (!closeDate) { setCloseError(t("dashboard.books.pickDate")); return; }
    if (!confirm(t("dashboard.books.confirmClose").replace("{date}", closeDate))) return;
    setClosing(true);
    setCloseError(null);
    try {
      const res = await ownerFetch(ownerId, "/api/daily-close", {
        method: "POST",
        body: JSON.stringify({ restaurantId: restaurantSlug, date: closeDate }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setCloseError(data.message || data.error || "Close failed");
      } else {
        await refresh();
      }
    } catch (err) {
      setCloseError(String(err));
    }
    setClosing(false);
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const url = `/api/export/orders?restaurantId=${restaurantSlug}&from=${exportFrom}&to=${exportTo}`;
      // Browser handles the download via Content-Disposition.
      const a = document.createElement("a");
      a.href = url;
      a.download = `orders_${exportFrom}_${exportTo}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch {}
    setExporting(false);
  };

  return (
    <div className="space-y-4">
      {/* Close a day */}
      <div className="bg-white rounded-2xl border border-sand-200 p-5 shadow-sm">
        <div className="mb-3">
          <h3 className="text-text-primary font-bold text-base">{t("dashboard.books.dailyClose")}</h3>
          <p className="text-text-muted text-xs">{t("dashboard.books.snapshotDesc")}</p>
        </div>
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <div>
            <label className="block text-[10px] font-bold text-text-muted uppercase mb-1">{t("dashboard.books.businessDay")}</label>
            <input
              type="date"
              value={closeDate}
              onChange={(e) => setCloseDate(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
              className="px-3 py-2 rounded-xl border-2 border-sand-200 text-sm"
            />
          </div>
          <button
            onClick={() => setCloseDate(cairoBusinessDayISO())}
            className="px-3 py-2 rounded-xl bg-sand-100 border border-sand-200 text-text-secondary text-xs font-bold hover:bg-sand-200"
          >
            {t("common.today")}
          </button>
          <button
            onClick={handleClose}
            disabled={closing || !ownerId}
            className="px-4 py-2.5 rounded-xl bg-ocean-600 text-white text-sm font-bold active:scale-95 disabled:opacity-50"
          >
            {closing ? t("dashboard.books.closing") : t("dashboard.books.closeDate").replace("{date}", closeDate)}
          </button>
        </div>
        {closeError && (
          <p className="text-xs text-status-bad-600 font-semibold mb-2">{closeError}</p>
        )}
        <div className="text-[11px] text-text-muted space-y-1">
          <p>{t("dashboard.books.revenueGroupedNote")}</p>
          <p>{t("dashboard.books.lateNightNote")}</p>
        </div>
      </div>

      {/* Export CSV */}
      <div className="bg-white rounded-2xl border border-sand-200 p-5 shadow-sm">
        <h3 className="text-text-primary font-bold text-base mb-1">{t("dashboard.books.exportCsv")}</h3>
        <p className="text-text-muted text-xs mb-3">{t("dashboard.books.downloadDesc")}</p>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-[10px] font-bold text-text-muted uppercase mb-1">{t("dashboard.books.from")}</label>
            <input type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)}
              className="px-3 py-2 rounded-xl border-2 border-sand-200 text-sm" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-text-muted uppercase mb-1">{t("dashboard.books.to")}</label>
            <input type="date" value={exportTo} onChange={(e) => setExportTo(e.target.value)}
              className="px-3 py-2 rounded-xl border-2 border-sand-200 text-sm" />
          </div>
          <button onClick={handleExport} disabled={exporting}
            className="px-4 py-2 rounded-xl bg-sand-700 text-white text-sm font-bold active:scale-95 disabled:opacity-50">
            {exporting ? "..." : t("dashboard.books.downloadCsv")}
          </button>
          <button onClick={printRange}
            className="px-4 py-2 rounded-xl bg-ocean-600 text-white text-sm font-bold active:scale-95">
            {t("dashboard.books.printReport")}
          </button>
        </div>
      </div>

      {/* Past closes */}
      <div className="bg-white rounded-2xl border border-sand-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-sand-200">
          <h3 className="text-text-primary font-bold text-base">{t("dashboard.books.pastCloses")}</h3>
          <p className="text-text-muted text-xs">{t("dashboard.books.daysOnRecord").replace("{count}", String(closes.length))}</p>
        </div>
        {closes.length === 0 ? (
          <div className="p-6 text-center text-text-muted text-sm">{t("dashboard.books.noCloses")}</div>
        ) : (
          <div className="divide-y divide-sand-100">
            {closes.map((c) => (
              <div key={c.id} className="px-5 py-3">
                <button onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                  className="w-full flex items-center justify-between text-left">
                  <div>
                    <p className="text-sm font-bold text-text-primary">{c.date}</p>
                    <p className="text-[11px] text-text-muted">
                      {c.totals.revenue.toLocaleString()} {t("common.egp")} · {c.totals.orders} {t("dashboard.books.orders")} · {t("dashboard.books.closedBy")} {c.closedByName || "—"}
                    </p>
                  </div>
                  <span className="text-text-muted text-xs">{expanded === c.id ? "▾" : "▸"}</span>
                </button>
                {expanded === c.id && (
                  <div className="mt-3 pt-3 border-t border-sand-100 space-y-2">
                    <button onClick={() => printClose(c)}
                      className="px-3 py-1.5 rounded-lg bg-ocean-600 text-white text-xs font-bold active:scale-95 mb-2">
                      {t("dashboard.books.printDay")}
                    </button>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div><span className="text-text-muted">{t("dashboard.books.cash")}:</span> <b>{c.totals.cash.toLocaleString()}</b></div>
                      <div><span className="text-text-muted">{t("dashboard.books.card")}:</span> <b>{c.totals.card.toLocaleString()}</b></div>
                      <div><span className="text-text-muted">{t("dashboard.books.instapay")}:</span> <b>{c.totals.instapay.toLocaleString()}</b></div>
                      <div><span className="text-text-muted">{t("dashboard.books.sessions")}:</span> <b>{c.totals.sessions}</b></div>
                      <div><span className="text-text-muted">{t("dashboard.books.comped")}:</span> <b>{c.totals.compedValue.toLocaleString()} ({c.totals.compedCount})</b></div>
                      <div><span className="text-text-muted">{t("dashboard.books.cancelled")}:</span> <b>{c.totals.cancelledValue.toLocaleString()} ({c.totals.cancelledCount})</b></div>
                    </div>
                    {c.totals.byWaiter.length > 0 && (
                      <div className="mt-2">
                        <p className="text-[10px] font-bold text-text-muted uppercase mb-1">{t("dashboard.books.byWaiter")}</p>
                        <div className="space-y-1">
                          {c.totals.byWaiter.map((w) => (
                            <div key={w.waiterId} className="flex items-center justify-between text-xs">
                              <span className="text-text-primary">{w.name}</span>
                              <span className="tabular-nums">{w.revenue.toLocaleString()} {t("common.egp")} · {w.orders} {t("dashboard.books.ord")} · {w.cash.toLocaleString()}c / {w.card.toLocaleString()}d</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Clock log — owner view of who actually worked when.
// Distinct from ShiftSchedule (planned roster). This is "what really
// happened" so the owner can pay hours fairly and contest disputes.
// Rendered as its own top-level "Hours" tab so owners looking for
// payroll data don't have to know to scroll the Books panel.
function ClockLogPanel({ restaurantSlug }: { restaurantSlug: string }) {
  const { t } = useLanguage();
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [shifts, setShifts] = useState<{ id: string; staffName: string; role: string; clockIn: string; clockOut: string | null; minutes: number | null }[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/clock", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId: restaurantSlug, from, to }),
      });
      if (res.ok) {
        const data = await res.json();
        setShifts(data.shifts || []);
      }
    } catch {}
    setLoading(false);
  }, [restaurantSlug, from, to]);

  useEffect(() => { load(); }, [load]);

  // Roll up by staff for a totals row.
  const byStaff = new Map<string, { name: string; role: string; minutes: number; shifts: number }>();
  for (const s of shifts) {
    const key = s.staffName + "|" + s.role;
    const agg = byStaff.get(key) || { name: s.staffName, role: s.role, minutes: 0, shifts: 0 };
    if (s.minutes != null) agg.minutes += s.minutes;
    agg.shifts += 1;
    byStaff.set(key, agg);
  }

  const fmtMin = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };
  const fmtTime = (iso: string) => new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });

  return (
    <div className="bg-white rounded-2xl border border-sand-200 overflow-hidden">
      <div className="px-5 py-3 border-b border-sand-200 flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-text-primary font-bold text-base">{t("dashboard.clock.title")}</h3>
          <p className="text-text-muted text-xs">{t("dashboard.clock.subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="px-2 py-1.5 rounded-lg border border-sand-200 text-xs" />
          <span className="text-text-muted text-xs">→</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="px-2 py-1.5 rounded-lg border border-sand-200 text-xs" />
        </div>
      </div>
      {loading ? (
        <div className="p-6 text-center text-text-muted text-sm">{t("dashboard.menu.loading")}</div>
      ) : shifts.length === 0 ? (
        <div className="p-6 text-center text-text-muted text-sm">{t("dashboard.clock.noClockins")}</div>
      ) : (
        <>
          {/* Totals */}
          <div className="px-5 py-3 bg-sand-50 border-b border-sand-100">
            <p className="text-[10px] font-bold text-text-muted uppercase mb-2">{t("dashboard.clock.totalsByStaff")}</p>
            <div className="space-y-1">
              {Array.from(byStaff.values())
                .sort((a, b) => b.minutes - a.minutes)
                .map((s) => (
                <div key={s.name + s.role} className="flex items-center justify-between text-xs">
                  <span className="text-text-primary font-semibold">{s.name} <span className="text-text-muted font-normal">· {s.role}</span></span>
                  <span className="tabular-nums"><b>{fmtMin(s.minutes)}</b> · {s.shifts} shift{s.shifts === 1 ? "" : "s"}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Detail */}
          <div className="divide-y divide-sand-100 max-h-[400px] overflow-y-auto">
            {shifts.map((s) => (
              <div key={s.id} className="px-5 py-2 flex items-center justify-between text-xs">
                <div>
                  <p className="font-semibold text-text-primary">{s.staffName} <span className="text-text-muted font-normal">· {s.role}</span></p>
                  <p className="text-text-muted">{fmtTime(s.clockIn)} → {s.clockOut ? fmtTime(s.clockOut) : <span className="text-status-good-600 font-bold">{t("dashboard.clock.onShift")}</span>}</p>
                </div>
                <span className="tabular-nums font-bold">
                  {s.minutes != null ? fmtMin(s.minutes) : "—"}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════
// SIDEBAR NAV
// ═════════════════════════════════════════════════

// Nav is split into two groups:
//   "Live" = passive monitoring (what's happening right now / what happened)
//   "Manage" = active control (editing configuration, people, or policy)
// The split helps the owner know which mode they're in — glance vs act.
// Manual lives on its own at the end so it's always one reach from any tab.
// Labels carry i18n keys rather than literal English so the sidebar flips
// with the language toggle.
const NAV_GROUPS: { labelKey: string; items: { id: NavTab; labelKey: string; icon: string }[] }[] = [
  {
    labelKey: "dashboard.nav.live",
    items: [
      { id: "overview", labelKey: "dashboard.nav.overview", icon: "◉" },
      { id: "analytics", labelKey: "dashboard.nav.analytics", icon: "📊" },
    ],
  },
  {
    labelKey: "dashboard.nav.manage",
    items: [
      { id: "menu", labelKey: "dashboard.nav.menu", icon: "🍽" },
      { id: "staff", labelKey: "dashboard.nav.staff", icon: "◎" },
      { id: "controls", labelKey: "dashboard.nav.controls", icon: "⚡" },
      { id: "vip", labelKey: "dashboard.nav.vip", icon: "\u{1F451}" },
      { id: "books", labelKey: "dashboard.nav.books", icon: "📒" },
      { id: "hours", labelKey: "dashboard.nav.hours", icon: "⏱" },
    ],
  },
  {
    labelKey: "dashboard.nav.help",
    items: [{ id: "manual", labelKey: "dashboard.nav.manual", icon: "📖" }],
  },
];

// Flat nav. Groups stay in the data model so i18n keys still resolve,
// but the UI renders them as one continuous stack — no dividers, no
// headers, no visual categorization.
const NAV_ITEMS_FLAT = NAV_GROUPS.flatMap((g) => g.items);

function Sidebar({ active, onChange }: { active: NavTab; onChange: (tab: NavTab) => void }) {
  const { t } = useLanguage();
  return (
    <aside className="hidden lg:flex flex-col w-20 glass-strong border-r border-sand-200/60 items-center py-6 gap-1 sticky top-16 self-start h-[calc(100dvh-4rem)] overflow-y-auto no-scrollbar">
      {NAV_ITEMS_FLAT.map((item) => {
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            onClick={() => onChange(item.id)}
            className="relative w-14 h-14 rounded-xl flex flex-col items-center justify-center gap-0.5 group transition-colors"
          >
            {/* Active background — animated between selections via layoutId */}
            {isActive && (
              <motion.span
                layoutId="dashboard-nav-active-bg"
                className="absolute inset-0 rounded-xl bg-gradient-to-br from-ocean-50 to-ocean-100 border border-ocean-200 shadow-sm"
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
              />
            )}
            {/* Hover overlay — fades in on hover for non-active tabs */}
            {!isActive && (
              <span className="absolute inset-0 rounded-xl bg-sand-100 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
            )}
            <motion.span
              whileTap={{ scale: 0.88 }}
              transition={{ type: "spring", stiffness: 600, damping: 25 }}
              className={`relative z-10 text-base transition-transform duration-200 group-hover:scale-110 ${
                isActive ? "text-ocean-700" : "text-text-muted group-hover:text-text-secondary"
              }`}
            >
              {item.icon}
            </motion.span>
            <span
              className={`relative z-10 text-[8px] font-extrabold uppercase tracking-[0.15em] transition-colors duration-200 ${
                isActive ? "text-ocean-700" : "text-text-muted group-hover:text-text-secondary"
              }`}
            >
              {t(item.labelKey)}
            </span>
            {/* Active right-edge indicator pip */}
            {isActive && (
              <motion.span
                layoutId="dashboard-nav-active-pip"
                className="absolute -right-3 top-1/2 -translate-y-1/2 w-1.5 h-7 rounded-l-full bg-ocean-500"
                transition={{ type: "spring", stiffness: 500, damping: 35 }}
              />
            )}
          </button>
        );
      })}
    </aside>
  );
}

function MobileNav({ active, onChange }: { active: NavTab; onChange: (tab: NavTab) => void }) {
  const { t } = useLanguage();

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-40 glass-strong border-t border-sand-200/60 safe-bottom">
      <div className="relative flex">
        {NAV_ITEMS_FLAT.map((item) => {
          const isActive = active === item.id;
          return (
            <motion.button
              key={item.id}
              whileTap={{ scale: 0.92 }}
              onClick={() => onChange(item.id)}
              className={`flex-1 py-2.5 flex flex-col items-center gap-0.5 relative transition-colors ${
                isActive ? "text-ocean-600" : "text-text-muted"
              }`}
            >
              <span className={`text-base transition-transform duration-200 ${isActive ? "scale-110" : ""}`}>
                {item.icon}
              </span>
              <span className="text-[9px] font-extrabold uppercase tracking-wider">{t(item.labelKey)}</span>
              {isActive && (
                <motion.span
                  layoutId="dashboard-mobile-nav-underline"
                  className="absolute bottom-0 w-8 h-[3px] rounded-t-full bg-ocean-500"
                  transition={{ type: "spring", stiffness: 500, damping: 35 }}
                />
              )}
            </motion.button>
          );
        })}
      </div>
    </nav>
  );
}

// ═════════════════════════════════════════════════
// MAIN: OWNER COMMAND CENTER
// ═════════════════════════════════════════════════

// Owner-only PIN gate. Without this, anyone who got past the home-page
// access PIN could navigate directly to /dashboard and see live revenue,
// staff, and schedules — the home PIN is shared and lives in the client
// bundle, so it's not a real authorization boundary.
const DASHBOARD_OWNER_KEY = "dashboard_owner";

type DashboardOwner = { id: string; name: string; ts: number };

function OwnerLogin({ onLogin }: { onLogin: (owner: DashboardOwner) => void }) {
  const { t } = useLanguage();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const restaurantSlug = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";

  const submit = async () => {
    if (pin.length < 4) { setError(t("dashboard.enterOwnerPin")); return; }
    setError(""); setLoading(true);
    try {
      const res = await fetch("/api/staff/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, restaurantId: restaurantSlug }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || t("dashboard.invalidPin")); setLoading(false); return;
      }
      const staff = await res.json();
      if (staff.role !== "OWNER") { setError(t("dashboard.notOwnerPin")); setLoading(false); return; }
      onLogin({ id: staff.id, name: staff.name, ts: Date.now() });
    } catch { setError(t("dashboard.networkError")); }
    setLoading(false);
  };

  return (
    <div className="min-h-dvh bg-sand-100 flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-3xl shadow-xl p-8">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-sand-700 flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl text-white font-semibold">🧠</span>
          </div>
          <h1 className="text-xl font-semibold text-text-primary">{t("dashboard.ownerLogin")}</h1>
          <p className="text-sm text-text-secondary mt-1">{t("dashboard.enterPinAccess")}</p>
        </div>
        <div className="flex justify-center gap-3 mb-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`w-12 h-14 rounded-xl border-2 flex items-center justify-center text-xl font-semibold transition-all ${
              pin.length > i ? "border-sand-700 bg-sand-50 text-sand-900" : "border-sand-200 bg-white text-transparent"
            }`}>{pin.length > i ? "●" : "○"}</div>
          ))}
        </div>
        {error && <p className="text-center text-status-bad-600 text-sm font-semibold mb-4">{error}</p>}
        <div className="grid grid-cols-3 gap-2 mb-6">
          {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((key) => (
            <button
              key={key || "empty"}
              onClick={() => {
                if (key === "⌫") setPin((p) => p.slice(0, -1));
                else if (key && pin.length < 6) { setPin((p) => p + key); setError(""); }
              }}
              disabled={!key}
              className={`h-14 rounded-xl text-xl font-bold transition-all active:scale-95 ${
                key === "⌫" ? "bg-sand-100 text-text-secondary" : key ? "bg-sand-50 text-text-primary hover:bg-sand-100" : "invisible"
              }`}
            >{key}</button>
          ))}
        </div>
        <button onClick={submit} disabled={pin.length < 4 || loading}
          className={`w-full py-4 rounded-2xl text-lg font-bold transition-all ${
            pin.length >= 4 && !loading ? "bg-sand-700 text-white hover:bg-sand-800" : "bg-sand-200 text-text-muted cursor-not-allowed"
          }`}
        >{loading ? t("dashboard.verifying") : t("dashboard.openDashboard")}</button>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [owner, setOwner] = useState<DashboardOwner | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(DASHBOARD_OWNER_KEY);
      if (saved) {
        const parsed: DashboardOwner = JSON.parse(saved);
        // 16-hour session, same window staff pages use
        if (parsed.id && Date.now() - parsed.ts < 16 * 60 * 60 * 1000) {
          setOwner(parsed);
        }
      }
    } catch {}
    setHydrated(true);
  }, []);

  if (!hydrated) return null;
  if (!owner) {
    return (
      <OwnerLogin
        onLogin={(o) => {
          try { localStorage.setItem(DASHBOARD_OWNER_KEY, JSON.stringify(o)); } catch {}
          setOwner(o);
        }}
      />
    );
  }
  return <OwnerControlSystem verifiedOwnerId={owner.id} />;
}

function OwnerControlSystem({ verifiedOwnerId }: { verifiedOwnerId: string }) {
  const { lang, toggleLang, t, tr, dir } = useLanguage();
  const perception = usePerception();
  const actionState = useAction();
  const boostItem = useAction((s) => s.boostItem);
  const activatePromo = useAction((s) => s.activatePromo);
  const sys = useSystemState();

  const [insights, setInsights] = useState<Insight[]>([]);
  const [selectedTable, setSelectedTable] = useState<TableState | null>(null);
  const [activeTab, setActiveTab] = useState<NavTab>("overview");
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(verifiedOwnerId);
  const ownerIdRef = useRef<string | null>(null);
  ownerIdRef.current = ownerId;
  const [now, setNow] = useState(Date.now());
  const [sessions, setSessions] = useState<{ id: string; tableNumber: number | null; waiterId?: string; waiterName?: string; status: string; orderType?: string; vipGuestName?: string | null; orderTotal?: number; openedAt?: string }[]>([]);

  useLiveData(ownerId ?? undefined);
  useEffect(() => { useMenu.getState().initialize(); }, []);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    const interval = setInterval(() => setInsights(generateInsights(usePerception.getState())), 6000);
    setInsights(generateInsights(usePerception.getState()));
    return () => clearInterval(interval);
  }, []);

  const restaurantSlug = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";

  const fetchStaff = useCallback(async () => {
    try {
      const res = await fetch(`/api/staff?restaurantId=${restaurantSlug}`);
      if (res.ok) {
        const data = await res.json();
        setStaff(data);
        // ownerId is pinned to the verified login — don't overwrite it
        // here. The auto-resolve path was a footgun (any OWNER in the
        // table would do), and it'd silently disagree with whoever
        // actually authenticated.
      }
    } catch { /* silent */ }
  }, [restaurantSlug]);
  useEffect(() => { fetchStaff(); }, [fetchStaff]);

  // Sync today's schedule → Staff.shift once ownerId is known
  useEffect(() => {
    if (!ownerId) return;
    ownerFetch(ownerId, "/api/schedule/sync", {
      method: "POST",
      body: JSON.stringify({ restaurantId: restaurantSlug }),
    }).then(() => fetchStaff()).catch(() => {});
  }, [ownerId, restaurantSlug, fetchStaff]);

  // Poll sessions for assign-table feature. 20s + visibility-pause:
  // sessions don't churn fast enough to need 10s, and a backgrounded
  // tab shouldn't keep hitting the API.
  useEffect(() => {
    async function fetchSessions() {
      try {
        const res = await ownerFetch(ownerIdRef.current, `/api/sessions/all?restaurantId=${restaurantSlug}`, { method: "GET" });
        if (res.ok) {
          const data = await res.json();
          setSessions(data.sessions || []);
        }
      } catch { /* silent */ }
    }
    fetchSessions();
    return startPoll(fetchSessions, 20000);
  }, [restaurantSlug, ownerId]);

  const { metrics, tableStates, kitchen, bar, orders } = perception;
  const itemPerf = analyzeItemPerformance(perception.itemViews, orders);
  const productLeaks = itemPerf.filter((p) => p.trend === "leaking");

  const handleSendWaiter = useCallback((tableId: number) => { sendOwnerMessage({ type: "command", text: `Go to Table ${tableId} — owner request`, tableId, command: "send_waiter" }, ownerIdRef.current); setSelectedTable(null); }, []);
  const handlePrioritize = useCallback((orderId: string) => { const order = orders.find((o) => o.id === orderId); sendOwnerMessage({ type: "command", text: `PRIORITY: Order #${order?.orderNumber || "?"} (Table ${order?.tableNumber || "?"}) — rush this order`, orderId, command: "prioritize" }, ownerIdRef.current); setSelectedTable(null); }, [orders]);
  const handlePushRecommendation = useCallback((tableId: number) => { useMenu.getState().allItems.filter((i) => i.bestSeller).slice(0, 2).forEach((i) => boostItem(i.id, `Push to T${tableId}`)); sendOwnerMessage({ type: "command", text: `Push menu recommendations to Table ${tableId}`, tableId, command: "push_menu" }, ownerIdRef.current); setSelectedTable(null); }, [boostItem]);

  const handleAcceptInsight = useCallback((insight: Insight) => {
    if (!insight.action) return;
    if (insight.action.type === "boost_item" && insight.action.payload.itemId) boostItem(insight.action.payload.itemId, insight.title);
    if (insight.action.type === "activate_promo") activatePromo({ id: `ai-${Date.now()}`, type: "flash", title: insight.title, subtitle: insight.description, badge: "AI", itemIds: [], active: true });
    if (insight.action.type === "alert_kitchen") sendOwnerMessage({ type: "command", text: `AI ALERT: ${insight.title} — ${insight.description}`, command: "prioritize" }, ownerIdRef.current);
    if (insight.action.type === "push_upsell") sendOwnerMessage({ type: "alert", text: `AI: ${insight.title}` }, ownerIdRef.current);
  }, [boostItem, activatePromo]);

  const handleAddTable = useCallback(async () => {
    try {
      const res = await ownerFetch(ownerIdRef.current, "/api/tables", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId: restaurantSlug }),
      });
      if (!res.ok) return;
      const table = await res.json();
      const state = usePerception.getState();
      const now = Date.now();
      const newTable: TableState = {
        id: table.number, status: "empty", guestCount: 0, sessionStart: now,
        currentOrderValue: 0, engagementScore: 0, itemsViewed: 0, itemsOrdered: 0,
        lastActivity: now, alerts: [],
      };
      usePerception.setState({ tableStates: [...state.tableStates, newTable] });
    } catch { /* silent */ }
  }, [restaurantSlug]);

  const handleRemoveTable = useCallback(async (tableNumber: number): Promise<boolean> => {
    try {
      const res = await ownerFetch(ownerIdRef.current, "/api/tables", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restaurantId: restaurantSlug, tableNumber }),
      });
      if (!res.ok) {
        return false;
      }
      const state = usePerception.getState();
      usePerception.setState({ tableStates: state.tableStates.filter((t) => t.id !== tableNumber) });
      return true;
    } catch { return false; }
  }, [restaurantSlug]);

  const handleLeakBoost = useCallback((itemId: string) => boostItem(itemId, "Leak fix — boost"), [boostItem]);
  const handleLeakDiscount = useCallback((itemId: string) => { activatePromo({ id: `discount-${itemId}`, type: "flash", title: `Discount: ${useMenu.getState().allItems.find((i) => i.id === itemId)?.name}`, subtitle: "Auto-discount to fix conversion", badge: "Discount", itemIds: [itemId], discountPercent: 10, active: true }); }, [activatePromo]);
  const handleLeakHide = useCallback((itemId: string) => boostItem(itemId, "Hidden — low performance"), [boostItem]);
  const handleRevertDecision = useCallback((id: string) => sys.revertDecision(id), [sys]);

  const handleAssignTable = useCallback(async (sessionIdOrTableNumber: string | number, waiterId: string): Promise<{ ok: boolean; message?: string }> => {
    try {
      let sessionId: string;

      if (typeof sessionIdOrTableNumber === "number") {
        // No active session — create one and assign the waiter
        const createRes = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tableNumber: sessionIdOrTableNumber, restaurantId: restaurantSlug, guestType: "walkin" }),
        });
        if (!createRes.ok) {
          const data = await createRes.json().catch(() => ({}));
          return { ok: false, message: data.message || data.error || "Could not open table" };
        }
        const created = await createRes.json();
        sessionId = created.id;
      } else {
        sessionId = sessionIdOrTableNumber;
      }

      const patchRes = await ownerFetch(ownerIdRef.current, "/api/sessions", {
        method: "PATCH",
        body: JSON.stringify({ sessionId, action: "assign_waiter", waiterId }),
      });
      if (!patchRes.ok) {
        const data = await patchRes.json().catch(() => ({}));
        return { ok: false, message: data.message || data.error || "Assign failed" };
      }
      // Refresh sessions
      const res = await ownerFetch(ownerIdRef.current, `/api/sessions/all?restaurantId=${restaurantSlug}`, { method: "GET" });
      if (res.ok) {
        const data = await res.json();
        setSessions(data.sessions || []);
      }
      return { ok: true };
    } catch {
      return { ok: false, message: "Network error" };
    }
  }, [restaurantSlug]);

  const hour = new Date().getHours();
  const timeLabel = hour >= 6 && hour < 12 ? t("dashboard.timeLabel.morning") : hour >= 12 && hour < 17 ? t("dashboard.timeLabel.afternoon") : hour >= 17 && hour < 21 ? t("dashboard.timeLabel.evening") : t("dashboard.timeLabel.night");
  const kitchenColor = kitchen.capacity > 80 ? "text-coral-600" : kitchen.capacity > 50 ? "text-sunset-500" : "text-success";
  const pendingCount = orders.filter((o) => o.status === "pending").length;
  const delayedCount = orders.filter((o) => o.isDelayed).length;

  // Shift-scoped average serving time = avg(servedAt - createdAt)
  // across orders served inside the current shift's Cairo window.
  // Replaces the "tips" KPI tile, since shift-level serving time is
  // a more actionable signal at-a-glance for the owner. Tips remain
  // derivable from the books tab + the cashier card.
  const shiftAvgServeMin = (() => {
    const cairoNow = nowInRestaurantTz();
    const shift = getCurrentShift();
    const shiftStartHour = shift === 1 ? 0 : shift === 2 ? 8 : 16;
    const shiftStartCairo = new Date(
      cairoNow.getFullYear(), cairoNow.getMonth(), cairoNow.getDate(), shiftStartHour, 0, 0, 0,
    );
    const offset = new Date().getTime() - cairoNow.getTime();
    const shiftStartMs = shiftStartCairo.getTime() + offset;
    const samples = orders.filter(
      (o) =>
        typeof o.servedAt === "number" &&
        typeof o.createdAt === "number" &&
        o.servedAt >= shiftStartMs,
    );
    if (samples.length === 0) return 0;
    const total = samples.reduce((s, o) => s + (o.servedAt! - o.createdAt) / 60000, 0);
    return Math.round(total / samples.length);
  })();

  return (
    <div className="min-h-dvh bg-sunset" dir={dir}>
      {/* Header */}
      <header className="sticky top-0 z-40 glass-strong border-b border-sand-200/60 px-5 py-3">
        <div className="max-w-[1440px] mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-ocean-400 to-ocean-600 flex items-center justify-center shadow-md">
              <span className="text-white font-semibold text-sm">T</span>
            </div>
            <div>
              <h1 className="text-sm font-bold text-text-primary flex items-center gap-2">
                {t("dashboard.commandCenter")}
                <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
                {pendingCount > 0 && <span className="px-2 py-0.5 rounded-full bg-coral-100 text-coral-600 text-[10px] font-bold animate-pulse">{pendingCount} {t("dashboard.header.pending")}</span>}
                {delayedCount > 0 && <span className="px-2 py-0.5 rounded-full bg-sunset-400/15 text-sunset-500 text-[10px] font-bold">{delayedCount} {t("dashboard.header.delayed")}</span>}
              </h1>
              <p className="text-[11px] text-text-muted">
                {metrics.guestsNow} {t("dashboard.guests")} · {metrics.occupancy}% {t("dashboard.header.occupancy")} · {timeLabel} · {t("dashboard.header.kitchen")}: <span className={kitchenColor}>{kitchen.activeOrders} {t("dashboard.header.orders")}, {kitchen.avgPrepTime > 0 ? `${kitchen.avgPrepTime}${t("common.minutes")} ${t("dashboard.header.avgSuffix")}` : t("dashboard.header.noData")}</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 lg:hidden">
            <LanguageToggle lang={lang} onToggle={toggleLang} />
            <LogoutButton role="owner" />
          </div>
          <div className="hidden lg:flex items-center gap-6">
            <div className="text-right">
              <p className="text-[9px] text-text-muted uppercase tracking-wider">{t("dashboard.kpi.revenue")}</p>
              <p className="text-sm font-bold text-success tabular-nums">{formatEGP(metrics.revenueToday)} {t("common.egp")}</p>
            </div>
            <div className="text-right">
              <p className="text-[9px] text-text-muted uppercase tracking-wider">{t("dashboard.kpi.orders")}</p>
              <p className="text-sm font-bold text-text-primary tabular-nums">{metrics.ordersToday}</p>
            </div>
            <div className="text-right">
              <p className="text-[9px] text-text-muted uppercase tracking-wider">{t("dashboard.header.avgOrder")}</p>
              <p className="text-sm font-bold text-text-primary tabular-nums">{formatEGP(metrics.avgOrderValue)} {t("common.egp")}</p>
            </div>
            <LanguageToggle lang={lang} onToggle={toggleLang} />
            <LogoutButton role="owner" />
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        <Sidebar active={activeTab} onChange={setActiveTab} />

        <main className="flex-1 max-w-[1380px] mx-auto px-4 pt-4 pb-20 lg:pb-8">
          <AnimatePresence mode="wait">
            {activeTab === "overview" && (
              <motion.div key="overview" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                  <KpiCard icon="◈" label={t("dashboard.kpi.revenue")} value={metrics.revenueToday} unit={t("common.egp")} accent="text-success" sub={`${(metrics.ordersPerMinute * 60).toFixed(1)} ${t("dashboard.kpi.ordersPerHour")}`} />
                  <KpiCard icon="◇" label={t("dashboard.kpi.orders")} value={metrics.ordersToday} accent="text-ocean-600" sub={`${formatEGP(metrics.avgOrderValue)} ${t("dashboard.kpi.avg")}`} />
                  <KpiCard
                    icon="◐"
                    label={t("dashboard.kpi.shiftServeTime")}
                    value={shiftAvgServeMin}
                    unit={t("common.minutes")}
                    placeholder={shiftAvgServeMin === 0 ? "—" : undefined}
                    accent={shiftAvgServeMin > 20 ? "text-coral-600" : shiftAvgServeMin > 12 ? "text-sunset-500" : "text-success"}
                    sub={shiftAvgServeMin === 0 ? t("dashboard.kpi.shiftServeEmpty") : t("dashboard.kpi.shiftServeSub")}
                  />
                  <KpiCard
                    icon="◈"
                    label={t("dashboard.kpi.pickupTime")}
                    value={metrics.avgPickupTime}
                    unit={t("common.minutes")}
                    placeholder={metrics.avgPickupTime === 0 ? "—" : undefined}
                    accent={metrics.avgPickupTime > 5 ? "text-coral-600" : metrics.avgPickupTime > 3 ? "text-sunset-500" : "text-success"}
                    sub={metrics.avgPickupTime === 0 ? t("dashboard.kpi.pickupEmpty") : metrics.avgPickupTime > 5 ? t("dashboard.kpi.pickupSlow") : t("dashboard.kpi.pickupFast")}
                  />
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="space-y-4">
                    <FloorMap tables={tableStates} orders={orders} onSelectTable={setSelectedTable} sessions={sessions} />
                    <AIBrain insights={insights} decisions={sys.decisions} onAcceptInsight={handleAcceptInsight} onDismissInsight={() => {}} onRevertDecision={handleRevertDecision} />
                  </div>
                  <div className="space-y-4">
                    <LiveOrdersFeed orders={orders} />
                    <VipDeliveryActivity orders={orders} sessions={sessions} />
                    <PaymentBreakdown orders={orders} />
                    <KitchenStatus kitchen={kitchen} bar={bar.activeOrders > 0 || bar.capacity > 0 ? bar : undefined} />
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === "staff" && (
              <motion.div key="staff" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <StaffPanel staff={staff} onRefresh={fetchStaff} restaurantId={restaurantSlug} restaurantSlug={restaurantSlug} ownerId={ownerId} />
                  <ShiftOverview staff={staff} restaurantSlug={restaurantSlug} />
                </div>
                <div className="mt-4">
                  <SchedulePanel staff={staff} restaurantSlug={restaurantSlug} onRefresh={fetchStaff} ownerId={ownerId} />
                </div>
              </motion.div>
            )}

            {activeTab === "menu" && (
              <motion.div key="menu" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
                <MenuPanel restaurantId={restaurantSlug} ownerId={ownerId} />
              </motion.div>
            )}

            {activeTab === "analytics" && (
              <motion.div key="analytics" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
                <AnalyticsPanel restaurantId={restaurantSlug} ownerId={ownerId} />
              </motion.div>
            )}

            {activeTab === "vip" && (
              <motion.div key="vip" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
                <div className="space-y-4">
                  <VipDeliveryActivity orders={orders} sessions={sessions} />
                  <VipPanel restaurantSlug={restaurantSlug} ownerId={ownerId} />
                </div>
              </motion.div>
            )}

            {activeTab === "books" && (
              <motion.div key="books" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
                <BooksPanel restaurantSlug={restaurantSlug} ownerId={ownerId} />
              </motion.div>
            )}

            {activeTab === "hours" && (
              <motion.div key="hours" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
                <ClockLogPanel restaurantSlug={restaurantSlug} />
              </motion.div>
            )}

            {activeTab === "manual" && (
              <motion.div key="manual" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
                <OwnerManual onJumpToTab={setActiveTab} />
              </motion.div>
            )}

            {activeTab === "controls" && (
              <motion.div key="controls" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.2 }}>
                <div className="mb-4">
                  <FloorLayoutBuilder tables={tableStates} orders={orders} onSelectTable={setSelectedTable} onAddTable={handleAddTable} onRemoveTable={handleRemoveTable} sessions={sessions} />
                </div>
                <div className="mb-4">
                  <QRCodePanel tables={tableStates.map((t) => ({ id: t.id }))} restaurantSlug={restaurantSlug} restaurantName={RESTAURANT_NAME} />
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="space-y-4">
                    <QuickControls onBoostItem={boostItem} onActivatePromo={activatePromo} activePromotions={actionState.activePromotions} />
                    <KitchenConfigPanel restaurantSlug={restaurantSlug} ownerId={ownerId} />
                  </div>
                  <div className="space-y-4">
                    <MenuPerformance leaks={productLeaks} onBoost={handleLeakBoost} onDiscount={handleLeakDiscount} onHide={handleLeakHide} />
                  </div>
                </div>
                <DangerZone restaurantId={restaurantSlug} ownerId={ownerId} />
              </motion.div>
            )}
          </AnimatePresence>
        </main>
      </div>

      {/* Floating voice note bubble — owner can broadcast from any tab */}
      <VoiceNoteBubble staff={staff} restaurantSlug={restaurantSlug} ownerId={ownerId} />

      <MobileNav active={activeTab} onChange={setActiveTab} />

      <AnimatePresence>
        {selectedTable && (
          <TableDetailModal table={selectedTable} orders={orders} onClose={() => setSelectedTable(null)} onSendWaiter={handleSendWaiter} onPrioritize={handlePrioritize} onPushRecommendation={handlePushRecommendation} sessions={sessions} staff={staff} onAssignTable={handleAssignTable} ownerId={ownerId} />
        )}
      </AnimatePresence>
    </div>
  );
}
