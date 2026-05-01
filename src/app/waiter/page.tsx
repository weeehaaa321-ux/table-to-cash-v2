"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLanguage } from "@/lib/use-language";
import { LanguageToggle } from "@/presentation/components/ui/LanguageToggle";
import { NotificationBadge } from "@/presentation/components/ui/NotificationBadge";
import {
  usePerception,
  type LiveOrder,
  type TableState,
} from "@/lib/engine/perception";
import { useLiveData } from "@/lib/use-live-data";
import { useMenu } from "@/store/menu";
import { getShiftTimer, getShiftLabel } from "@/lib/shifts";
import SchedulePopup from "@/presentation/components/ui/SchedulePopup";
import { OrderHistoryDrawer } from "@/presentation/components/ui/OrderHistoryDrawer";
import { ClockButton } from "@/presentation/components/ui/ClockButton";
import { getOrderLabel } from "@/lib/order-label";
import {
  requestNotificationPermission,
  notifyOrderReady,
  notifyOwnerCommand,
  notifyVoiceNote,
} from "@/lib/notifications";
import { staffFetch } from "@/lib/staff-fetch";
import { startPoll } from "@/lib/polling";

// ═══════════════════════════════════════════════
// CONSTANTS + HELPERS
// ═══════════════════════════════════════════════

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; textColor: string; priority: number }
> = {
  pending: { label: "NEW", color: "#ef4444", bg: "#fef2f2", textColor: "#991b1b", priority: 1 },
  confirmed: { label: "CONFIRMED", color: "#3b82f6", bg: "#eff6ff", textColor: "#1e40af", priority: 3 },
  preparing: { label: "COOKING", color: "#f59e0b", bg: "#fffbeb", textColor: "#92400e", priority: 2 },
  ready: { label: "READY", color: "#22c55e", bg: "#f0fdf4", textColor: "#166534", priority: 0 },
  served: { label: "SERVED", color: "#94a3b8", bg: "#f8fafc", textColor: "#475569", priority: 4 },
  paid: { label: "PAID", color: "#cbd5e1", bg: "#f8fafc", textColor: "#64748b", priority: 5 },
};

const ACTION_CONFIG: Record<
  string,
  { label: string; bgColor: string; icon: string; nextStatus: string; confirmRequired?: boolean }
> = {
  ready: { label: "MARK SERVED", bgColor: "bg-status-good-600 hover:bg-status-good-700", icon: "✓", nextStatus: "served", confirmRequired: true },
};

const TABLE_STATUS_LABELS: Record<string, string> = {
  empty: "Idle",
  seated: "Seated",
  browsing: "Browsing",
  ordered: "Ordered",
  eating: "Eating",
  waiting_bill: "Bill",
  paying: "Paying",
};

function minsAgo(ts: number): number {
  return Math.max(0, Math.round((Date.now() - ts) / 60000));
}

function minsAgoText(ts: number): string {
  const m = minsAgo(ts);
  if (m < 1) return "now";
  return `${m}m`;
}

function formatEGP(n: number): string {
  return n.toLocaleString("en-EG");
}

// ═══════════════════════════════════════════════
// URGENCY CALCULATION
// ═══════════════════════════════════════════════

type UrgencyLevel = "normal" | "attention" | "critical";

function computeUrgency(order: LiveOrder, now: number): UrgencyLevel {
  const waitMin = (now - order.createdAt) / 60000;

  // Critical: pending > 3min, ready > 5min, delayed, or preparing > 20min
  if (order.isDelayed) return "critical";
  if (order.status === "pending" && waitMin > 3) return "critical";
  if (order.status === "ready" && waitMin > 20) return "critical";
  if (order.status === "preparing" && waitMin > 20) return "critical";

  // Attention: pending > 1min, ready > 2min, preparing > 12min
  if (order.status === "pending" && waitMin > 1) return "attention";
  if (order.status === "ready" && waitMin > 10) return "attention";
  if (order.status === "preparing" && waitMin > 12) return "attention";

  // High-value orders get attention
  if (order.total > 500) return "attention";

  return "normal";
}

const URGENCY_STYLES: Record<UrgencyLevel, { border: string; bg: string; badge: string; text: string }> = {
  normal: {
    border: "border-sand-200",
    bg: "bg-white",
    badge: "bg-status-good-100 text-status-good-800",
    text: "Normal",
  },
  attention: {
    border: "border-status-warn-300",
    bg: "bg-status-warn-50/40",
    badge: "bg-status-warn-100 text-status-warn-800",
    text: "Attention",
  },
  critical: {
    border: "border-status-bad-400",
    bg: "bg-status-bad-50/40",
    badge: "bg-status-bad-100 text-status-bad-800 animate-pulse",
    text: "Critical",
  },
};

// ═══════════════════════════════════════════════
// ERROR PREVENTION ENGINE
// ═══════════════════════════════════════════════

type ValidationError = {
  type: "duplicate" | "billing_mismatch" | "missing_items" | "wrong_table" | "unpaid";
  message: string;
  severity: "block" | "warn";
  orderId?: string;
};

function detectErrors(
  orders: LiveOrder[],
  tables: TableState[]
): ValidationError[] {
  const errors: ValidationError[] = [];

  // 1. Duplicate detection: only flag if same session has identical items within 2 minutes
  const activeBySession = new Map<string, LiveOrder[]>();
  for (const o of orders.filter((o) => ["pending", "confirmed"].includes(o.status) && o.sessionId)) {
    const key = o.sessionId!;
    const existing = activeBySession.get(key) || [];
    existing.push(o);
    activeBySession.set(key, existing);
  }
  for (const [, sessionOrders] of activeBySession) {
    if (sessionOrders.length < 2) continue;
    // Check for orders with identical items placed within 2 minutes of each other
    for (let i = 0; i < sessionOrders.length; i++) {
      for (let j = i + 1; j < sessionOrders.length; j++) {
        const a = sessionOrders[i], b = sessionOrders[j];
        const timeDiff = Math.abs(a.createdAt - b.createdAt) / 60000;
        if (timeDiff > 2) continue;
        // Check if items overlap significantly
        const aItems = a.items.map((it) => `${it.id}:${it.quantity}`).sort().join(",");
        const bItems = b.items.map((it) => `${it.id}:${it.quantity}`).sort().join(",");
        if (aItems === bItems) {
          errors.push({
            type: "duplicate",
            message: `${getOrderLabel(a)}: Identical orders placed ${Math.round(timeDiff * 60)}s apart — likely duplicate`,
            severity: "warn",
            orderId: b.id,
          });
        }
      }
    }
  }

  // 2. Empty/no-item orders
  for (const order of orders.filter((o) => o.status === "pending")) {
    if (order.items.length === 0) {
      errors.push({
        type: "missing_items",
        message: `Order #${order.orderNumber}: No items — cannot process`,
        severity: "block",
        orderId: order.id,
      });
    }
  }

  return errors;
}

// ═══════════════════════════════════════════════
// ALERT SYSTEM
// ═══════════════════════════════════════════════

type StaffAlert = {
  id: string;
  type: "waiting" | "delayed" | "idle" | "kitchen" | "error" | "table_move";
  message: string;
  tableId?: number | null;
  orderId?: string;
  priority: number; // lower = more urgent
  timestamp: number;
};

function generateStaffAlerts(
  orders: LiveOrder[],
  tables: TableState[],
  kitchen: { capacity: number; stuckOrders: string[]; activeOrders: number },
  errors: ValidationError[],
  now: number
): StaffAlert[] {
  const alerts: StaffAlert[] = [];

  // Orders waiting too long
  for (const order of orders) {
    const waitMin = (now - order.createdAt) / 60000;

    if (order.status === "ready" && waitMin > 15) {
      alerts.push({
        id: `ready-${order.id}`,
        type: "waiting",
        message: `${getOrderLabel(order)} — food ready ${Math.round(waitMin - 10)}m, not served`,
        tableId: order.tableNumber,
        orderId: order.id,
        priority: 1,
        timestamp: now,
      });
    }

    if (order.isDelayed) {
      alerts.push({
        id: `delay-${order.id}`,
        type: "delayed",
        message: `Order #${order.orderNumber} (T${order.tableNumber}) — kitchen delay ${order.delayMinutes}m`,
        tableId: order.tableNumber,
        orderId: order.id,
        priority: 0,
        timestamp: now,
      });
    }
  }

  // Idle tables (seated but no activity)
  for (const table of tables) {
    if (
      table.status === "seated" &&
      table.itemsOrdered === 0 &&
      now - table.lastActivity > 180000
    ) {
      alerts.push({
        id: `idle-${table.id}`,
        type: "idle",
        message: `Table ${table.id} — seated ${Math.round((now - table.sessionStart) / 60000)}m, no order`,
        tableId: table.id,
        priority: 2,
        timestamp: now,
      });
    }
    if (
      table.status === "browsing" &&
      table.itemsOrdered === 0 &&
      now - table.lastActivity > 120000
    ) {
      alerts.push({
        id: `browse-${table.id}`,
        type: "idle",
        message: `Table ${table.id} — browsing ${Math.round((now - table.lastActivity) / 60000)}m, needs help`,
        tableId: table.id,
        priority: 2,
        timestamp: now,
      });
    }
  }

  // Kitchen overload
  if (kitchen.capacity > 85) {
    alerts.push({
      id: "kitchen-overload",
      type: "kitchen",
      message: `Kitchen at ${kitchen.capacity}% — expect delays`,
      priority: 1,
      timestamp: now,
    });
  }

  // Stuck orders
  if (kitchen.stuckOrders.length > 0) {
    alerts.push({
      id: "kitchen-stuck",
      type: "kitchen",
      message: `${kitchen.stuckOrders.length} order${kitchen.stuckOrders.length > 1 ? "s" : ""} stuck in kitchen`,
      priority: 0,
      timestamp: now,
    });
  }

  // Validation errors
  for (const err of errors) {
    alerts.push({
      id: `err-${err.type}-${err.orderId || "sys"}`,
      type: "error",
      message: err.message,
      orderId: err.orderId,
      priority: err.severity === "block" ? 0 : 1,
      timestamp: now,
    });
  }

  return alerts.sort((a, b) => a.priority - b.priority);
}

// ═══════════════════════════════════════════════
// MODULE 1: ALERT BAR (TOP PRIORITY)
// ═══════════════════════════════════════════════

function AlertBar({ alerts, onDismiss }: { alerts: StaffAlert[]; onDismiss: (id: string) => void }) {
  if (alerts.length === 0) return null;

  const typeIcons: Record<string, string> = {
    waiting: "⏱",
    delayed: "⚠",
    idle: "💤",
    kitchen: "🔥",
    error: "🚫",
    table_move: "↔",
  };

  const typeBg: Record<string, string> = {
    waiting: "bg-status-warn-50 border-status-warn-300 text-status-warn-900",
    delayed: "bg-status-bad-50 border-status-bad-300 text-status-bad-900",
    idle: "bg-status-info-50 border-status-info-300 text-status-info-900",
    kitchen: "bg-status-warn-50 border-status-warn-300 text-status-warn-900",
    error: "bg-status-bad-50 border-status-bad-400 text-status-bad-900",
    table_move: "bg-ocean-50 border-ocean-300 text-ocean-900",
  };

  return (
    <div className="space-y-1.5 mb-3">
      {alerts.slice(0, 5).map((alert) => (
        <motion.div
          key={alert.id}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, x: -20 }}
          className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border-2 ${typeBg[alert.type]} ${
            alert.priority === 0 ? "animate-pulse" : ""
          }`}
        >
          <span className="text-base flex-shrink-0">{typeIcons[alert.type]}</span>
          <span className="text-sm font-semibold flex-1">{alert.message}</span>
          <button
            onClick={() => onDismiss(alert.id)}
            className="text-xs opacity-50 hover:opacity-100 px-2 py-1 rounded-lg"
          >
            ✕
          </button>
        </motion.div>
      ))}
      {alerts.length > 5 && (
        <p className="text-xs text-text-secondary text-center">
          +{alerts.length - 5} more alert{alerts.length - 5 > 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// MODULE 2: TABLE CONTROL SYSTEM
// ═══════════════════════════════════════════════

function TableControlSystem({
  tables,
  orders,
  onSelectTable,
  myTableNumbers,
}: {
  tables: TableState[];
  orders: LiveOrder[];
  onSelectTable: (table: TableState) => void;
  myTableNumbers?: Set<number>;
}) {
  const { t } = useLanguage();
  const [expanded, setExpanded] = useState(false);
  const now = Date.now();
  const occupied = tables.filter((tb) => tb.status !== "empty");
  const alertCount = tables.reduce(
    (s, tb) => s + tb.alerts.filter((a) => a.type !== "high_value").length,
    0
  );

  const statusColors: Record<string, string> = {
    empty: "bg-sand-100 border-sand-200 text-text-muted",
    seated: "bg-status-info-50 border-status-info-300 text-status-info-800",
    browsing: "bg-status-info-50 border-status-info-300 text-status-info-800",
    ordered: "bg-status-warn-50 border-status-warn-300 text-status-warn-800",
    eating: "bg-status-good-50 border-status-good-300 text-status-good-800",
    waiting_bill: "bg-status-wait-50 border-status-wait-300 text-status-wait-800",
    paying: "bg-status-bad-50 border-status-bad-300 text-status-bad-800",
  };

  return (
    <div className="bg-white rounded-2xl border-2 border-sand-200 overflow-hidden">
      {/* Header — click to toggle */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-3 bg-sand-50 border-b-2 border-sand-200 flex items-center justify-between hover:bg-sand-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <svg
            className={`w-4 h-4 text-text-secondary transition-transform ${expanded ? "rotate-90" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <h3 className="font-extrabold text-text-primary text-sm uppercase tracking-wide">
            Tables
          </h3>
          <span className="text-xs text-text-secondary font-semibold">
            {occupied.length}/{tables.length}
          </span>
        </div>
        {alertCount > 0 && (
          <span className="px-2 py-0.5 rounded-full bg-status-bad-100 text-status-bad-700 text-[11px] font-bold">
            {alertCount} ALERT{alertCount > 1 ? "S" : ""}
          </span>
        )}
      </button>

      {!expanded ? null : (
      <>
      {/* Table Grid */}
      <div className="p-3 grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(52px, 1fr))" }}>
        {tables.map((table) => {
          const colors = statusColors[table.status] || statusColors.empty;
          const hasAlert = table.alerts.some((a) => a.type !== "high_value");
          const elapsed = table.status !== "empty" ? minsAgo(table.sessionStart) : 0;
          const tableOrder = orders.find(
            (o) => o.tableNumber === table.id && !["paid"].includes(o.status)
          );

          return (
            <button
              key={table.id}
              onClick={() => onSelectTable(table)}
              className={`relative rounded-xl border-2 ${colors} p-2 text-center transition-all active:scale-95 ${
                hasAlert ? "ring-2 ring-status-bad-400 ring-offset-1" : ""
              } ${table.status === "empty" ? "opacity-50" : ""}`}
            >
              {/* Table number */}
              <div className="text-sm font-semibold leading-none">{table.id}</div>

              {/* Status label */}
              {table.status !== "empty" && (
                <div className="text-[8px] font-bold uppercase tracking-wider mt-0.5 leading-none">
                  {t(`waiter.table.${table.status}`)}
                </div>
              )}

              {/* Time + Value */}
              {table.status !== "empty" && (
                <div className="mt-1 space-y-0.5">
                  <div className="text-[8px] font-semibold opacity-70">{elapsed}m</div>
                  {table.currentOrderValue > 0 && (
                    <div className="text-[8px] font-bold">{table.currentOrderValue}</div>
                  )}
                </div>
              )}


              {/* Alert dot */}
              {hasAlert && (
                <div className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-status-bad-500 animate-pulse" />
              )}

              {/* Guest count */}
              {table.guestCount > 0 && (
                <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-sand-700 text-white text-[7px] font-bold flex items-center justify-center">
                  {table.guestCount}
                </div>
              )}

              {/* My table badge */}
              {myTableNumbers?.has(table.id) && table.status !== "empty" && (
                <div className="absolute -top-1 -left-1 px-1 py-0.5 rounded bg-ocean-600 text-white text-[6px] font-semibold leading-none">
                  MINE
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Status Legend */}
      <div className="px-3 pb-3 flex flex-wrap gap-2 text-[9px] font-semibold text-text-secondary">
        {[
          { c: "bg-sand-300", k: "empty" },
          { c: "bg-status-info-400", k: "seated" },
          { c: "bg-status-info-400", k: "browsing" },
          { c: "bg-status-warn-400", k: "ordered" },
          { c: "bg-status-good-400", k: "eating" },
          { c: "bg-status-wait-400", k: "waiting_bill" },
        ].map((s) => (
          <span key={s.k} className="flex items-center gap-1">
            <span className={`w-2 h-2 rounded-full ${s.c}`} />
            {t(`waiter.table.${s.k}`)}
          </span>
        ))}
      </div>
      </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// TABLE DETAIL PANEL (FULL CONTROL)
// ═══════════════════════════════════════════════

function TableDetailPanel({
  table,
  orders,
  onClose,
  onUpdateTableStatus,
  onAdvanceOrder,
  isMyTable = true,
  waiterId,
  sessions,
  onTakeOrder,
}: {
  table: TableState;
  orders: LiveOrder[];
  onClose: () => void;
  onUpdateTableStatus: (tableId: number, status: TableState["status"]) => void;
  onAdvanceOrder: (orderId: string) => void;
  isMyTable?: boolean;
  waiterId?: string;
  sessions?: SessionInfo[];
  onTakeOrder?: (tableId: number, sessionId: string, guestCount: number) => void;
}) {
  const { t } = useLanguage();
  const elapsed = table.status !== "empty" ? minsAgo(table.sessionStart) : 0;
  const tableOrders = orders.filter(
    (o) => o.tableNumber === table.id && o.status !== "paid" && o.status !== "cancelled"
  );

  const statusColors: Record<string, string> = {
    empty: "bg-sand-200 text-text-secondary",
    seated: "bg-status-info-200 text-status-info-800",
    browsing: "bg-status-info-200 text-status-info-800",
    ordered: "bg-status-warn-200 text-status-warn-800",
    eating: "bg-status-good-200 text-status-good-800",
    waiting_bill: "bg-status-wait-200 text-status-wait-800",
    paying: "bg-status-bad-200 text-status-bad-800",
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end lg:items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <motion.div
        className="relative w-full max-w-lg mx-4 mb-4 lg:mb-0 bg-white rounded-2xl border-2 border-sand-200 overflow-hidden max-h-[85vh] overflow-y-auto"
        initial={{ y: 40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 40, opacity: 0 }}
      >
        {/* Header — table # is hero (~5xl), status pill below it, close button stays comfortable */}
        <div className="px-6 pt-6 pb-5 bg-sand-50 border-b-2 border-sand-200">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-4 min-w-0 flex-1">
              <div className={`w-20 h-20 rounded-2xl flex items-center justify-center flex-shrink-0 ${statusColors[table.status]}`}>
                <span className="text-4xl font-extrabold leading-none">{table.id}</span>
              </div>
              <div className="min-w-0 flex-1 pt-1">
                <div className="text-[10px] font-extrabold uppercase tracking-[0.18em] text-text-muted mb-1">
                  {t("common.table")}
                </div>
                <h3 className="text-3xl font-extrabold text-text-primary leading-none mb-2">
                  #{table.id}
                </h3>
                <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-widest ${statusColors[table.status]}`}>
                  {t(`waiter.table.${table.status}`)}
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              className="w-11 h-11 rounded-xl bg-sand-200 hover:bg-sand-300 flex items-center justify-center text-text-secondary transition active:scale-95 flex-shrink-0"
              aria-label="Close"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="6" y1="18" x2="18" y2="6" />
              </svg>
            </button>
          </div>
        </div>

        {/* Stats grid — uppercase labels, larger numbers, more breathing room */}
        <div className="p-4 grid grid-cols-4 gap-2">
          <div className="p-3 rounded-xl bg-sand-50 border border-sand-200/60">
            <div className="text-[9px] text-text-muted font-extrabold uppercase tracking-widest mb-1">
              {t("waiter.guests")}
            </div>
            <div className="text-xl font-extrabold tabular-nums text-text-primary leading-none">
              {table.guestCount}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-sand-50 border border-sand-200/60">
            <div className="text-[9px] text-text-muted font-extrabold uppercase tracking-widest mb-1">
              {t("waiter.table.seated")}
            </div>
            <div className="text-xl font-extrabold tabular-nums text-text-primary leading-none">
              {elapsed}<span className="text-xs text-text-muted ms-0.5 font-bold">m</span>
            </div>
          </div>
          <div className="p-3 rounded-xl bg-sand-50 border border-sand-200/60">
            <div className="text-[9px] text-text-muted font-extrabold uppercase tracking-widest mb-1">
              {t("waiter.value")}
            </div>
            <div className="text-xl font-extrabold tabular-nums text-status-good-700 leading-none">
              {formatEGP(table.currentOrderValue)}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-sand-50 border border-sand-200/60">
            <div className="text-[9px] text-text-muted font-extrabold uppercase tracking-widest mb-1">
              {t("waiter.viewed")}
            </div>
            <div className="text-xl font-extrabold tabular-nums text-text-primary leading-none">
              {table.itemsViewed}
            </div>
          </div>
        </div>

        {/* Alerts for this table */}
        {table.alerts.length > 0 && (
          <div className="px-4 pb-2">
            {table.alerts.map((alert, i) => (
              <div
                key={i}
                className="flex items-center gap-2 p-2.5 rounded-xl bg-status-bad-50 border-2 border-status-bad-200 text-status-bad-800 text-sm font-semibold mb-1.5"
              >
                <span>⚠</span>
                <span>{alert.message}</span>
              </div>
            ))}
          </div>
        )}

        {/* Timeline */}
        <div className="px-4 pb-3">
          <p className="text-[10px] text-text-secondary font-bold uppercase tracking-wider mb-2">
            Timeline
          </p>
          <div className="space-y-1.5 border-l-2 border-sand-200 pl-4 ml-2">
            <TimelineRow label={t("waiter.timeline.seated")} detail={table.status !== "empty" ? `${elapsed}m ago` : "—"} done={table.status !== "empty"} />
            <TimelineRow
              label={t("waiter.timeline.viewedMenu")}
              detail={table.itemsViewed > 0 ? `${table.itemsViewed} items` : "—"}
              done={table.itemsViewed > 0}
            />
            <TimelineRow
              label={t("waiter.timeline.ordered")}
              detail={table.itemsOrdered > 0 ? `${table.itemsOrdered} items` : "—"}
              done={table.itemsOrdered > 0}
            />
            <TimelineRow
              label={t("waiter.timeline.served")}
              detail={table.status === "eating" ? "Yes" : "—"}
              done={["eating", "waiting_bill", "paying"].includes(table.status)}
            />
            <TimelineRow
              label={t("waiter.timeline.payment")}
              detail={table.status === "paying" ? t("waiter.timeline.inProgress") : "—"}
              done={table.status === "paying"}
            />
          </div>
        </div>

        {/* Orders at this table */}
        {tableOrders.length > 0 && (
          <div className="px-4 pb-3">
            <p className="text-[10px] text-text-secondary font-bold uppercase tracking-wider mb-2">
              Active Orders
            </p>
            {tableOrders.map((order) => {
              const cfg = STATUS_CONFIG[order.status];
              const action = ACTION_CONFIG[order.status];
              return (
                <div key={order.id} className="rounded-xl bg-sand-50 border border-sand-200 mb-2 overflow-hidden">
                  {/* Status hero banner */}
                  {cfg && (
                    <div
                      className="flex items-center justify-between px-3 py-1.5"
                      style={{ backgroundColor: cfg.color }}
                    >
                      <span className="text-white text-[11px] font-extrabold uppercase tracking-[0.2em]">
                        {t(`waiter.status.${({pending:"new",confirmed:"confirmed",preparing:"cooking",ready:"ready",served:"served",paid:"paid"} as Record<string,string>)[order.status] ?? order.status}`)}
                      </span>
                      <span className="text-white/80 text-[10px] font-extrabold uppercase tracking-wider tabular-nums">
                        #{order.orderNumber}
                      </span>
                    </div>
                  )}
                  <div className="p-3">
                    {order.items.map((item, i) => (
                      <div key={i} className="flex justify-between text-sm py-0.5">
                        <span className="text-text-secondary">
                          <span className="font-extrabold text-text-primary tabular-nums">{item.quantity}×</span> {item.name}
                        </span>
                        <span className="text-text-secondary tabular-nums">{item.price * item.quantity}</span>
                      </div>
                    ))}
                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-sand-200">
                      <span className="text-lg font-extrabold text-text-primary tabular-nums tracking-tight">{formatEGP(order.total)} <span className="text-xs">{t("common.egp")}</span></span>
                      {action && isMyTable && (
                        <button
                          onClick={() => onAdvanceOrder(order.id)}
                          className={`px-4 py-2.5 rounded-xl text-white text-sm font-extrabold uppercase tracking-wider ${action.bgColor} active:scale-95 transition-transform`}
                        >
                          {action.icon} {t("waiter.markServed")}
                        </button>
                      )}
                      {action && !isMyTable && (
                        <span className="px-3 py-1.5 rounded-xl bg-sand-100 text-text-muted text-xs font-extrabold uppercase tracking-wider">
                          {t("waiter.notYourTable")}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Seat Table — shown when table is empty and it's my table */}
        {table.status === "empty" && isMyTable && <SeatTableForm tableId={table.id} onSeat={onUpdateTableStatus} onClose={onClose} waiterId={waiterId} />}
        {table.status === "empty" && !isMyTable && (
          <div className="p-4 bg-sand-50 border-t-2 border-sand-200">
            <p className="text-xs text-text-muted font-semibold text-center">
              {t("waiter.assignedToOther")}
            </p>
          </div>
        )}

        {/* Take Order / Collect Payment — for waiter-managed tables */}
        {table.status !== "empty" && isMyTable && (() => {
          const tableSession = sessions?.find(
            (s) => s.tableNumber === table.id && s.status === "OPEN"
          );
          return tableSession && onTakeOrder ? (
            <div className="px-4 pb-3">
              <button
                onClick={() => { onTakeOrder(table.id, tableSession.id, tableSession.guestCount || 1); onClose(); }}
                className="w-full p-3 rounded-xl text-center text-sm font-bold bg-ocean-600 text-white hover:bg-ocean-700 transition-all active:scale-95"
              >
                + {t("waiter.takeOrder")}
              </button>
            </div>
          ) : null;
        })()}

      </motion.div>
    </motion.div>
  );
}

function TimelineRow({ label, detail, done }: { label: string; detail: string; done: boolean }) {
  return (
    <div className="flex items-center gap-3 relative">
      <div
        className={`absolute -left-[21px] w-3 h-3 rounded-full border-2 ${
          done ? "bg-status-good-500 border-status-good-500" : "bg-white border-sand-300"
        }`}
      />
      <span className={`text-sm flex-1 ${done ? "text-text-primary font-semibold" : "text-text-muted"}`}>
        {label}
      </span>
      <span className={`text-xs tabular-nums ${done ? "text-text-secondary" : "text-text-muted"}`}>
        {detail}
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════
// SEAT TABLE FORM
// ═══════════════════════════════════════════════

function SeatTableForm({
  tableId,
  onSeat,
  onClose,
  waiterId,
}: {
  tableId: number;
  onSeat: (tableId: number, status: TableState["status"]) => void;
  onClose: () => void;
  waiterId?: string;
}) {
  const { t } = useLanguage();
  const [guestCount, setGuestCount] = useState(2);
  const [seating, setSeating] = useState(false);
  const updateTable = usePerception((s) => s.updateTable);
  const restaurantSlug = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";

  const handleSeat = async () => {
    if (seating) return;
    setSeating(true);

    // Create a real DB session
    try {
      await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tableNumber: tableId,
          restaurantId: restaurantSlug,
          guestCount,
          waiterId,
        }),
      });
    } catch { /* continue even if API fails */ }

    updateTable(tableId, {
      guestCount,
      sessionStart: Date.now(),
      lastActivity: Date.now(),
      engagementScore: 0,
      itemsViewed: 0,
      itemsOrdered: 0,
      currentOrderValue: 0,
      alerts: [],
    });
    onSeat(tableId, "seated");
    onClose();
  };

  return (
    <div className="p-4 bg-sand-50 border-t-2 border-sand-200 space-y-4">
      <p className="text-sm font-bold text-text-secondary">{t("waiter.seatTable")}</p>

      {/* Guest count */}
      <div>
        <p className="text-xs font-semibold text-text-secondary mb-2">{t("waiter.guests")}</p>
        <div className="flex gap-1.5 flex-wrap">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <button
              key={n}
              onClick={() => setGuestCount(n)}
              className={`w-9 h-9 rounded-lg text-sm font-bold transition-all ${
                guestCount === n
                  ? "bg-status-info-600 text-white shadow-sm"
                  : "bg-white text-text-secondary border border-sand-200 hover:border-status-info-300"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Seat button */}
      <button
        onClick={handleSeat}
        disabled={seating}
        className={`w-full p-3 rounded-xl text-center text-sm font-bold transition-all active:scale-95 ${
          seating ? "bg-status-info-400 text-white cursor-wait" : "bg-status-info-600 text-white hover:bg-status-info-700"
        }`}
      >
        {seating ? `${t("common.loading")}` : `${t("waiter.seat")} ${guestCount} ${guestCount === 1 ? t("common.guest") : t("common.guests")}`}
      </button>
    </div>
  );
}

// ═══════════════════════════════════════════════
// MODULE 1: ORDER CARD
// ═══════════════════════════════════════════════

function OrderCard({
  order,
  urgency,
  errors,
  onAdvance,
  onAddNote,
  now,
  isMyTable = true,
}: {
  order: LiveOrder;
  urgency: UrgencyLevel;
  errors: ValidationError[];
  onAdvance: () => void;
  onAddNote: (note: string) => void;
  now: number;
  isMyTable?: boolean;
}) {
  const { t } = useLanguage();
  const [confirming, setConfirming] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [showNoteInput, setShowNoteInput] = useState(false);
  const statusCfg = STATUS_CONFIG[order.status];
  const actionCfg = ACTION_CONFIG[order.status];
  const urgStyle = URGENCY_STYLES[urgency];
  const waitMin = minsAgo(order.createdAt);
  const orderErrors = errors.filter((e) => e.orderId === order.id);
  const isBlocked = orderErrors.some((e) => e.severity === "block");

  const handleAction = () => {
    if (isBlocked) return;
    if (actionCfg?.confirmRequired) {
      if (confirming) {
        onAdvance();
        setConfirming(false);
      } else {
        setConfirming(true);
        setTimeout(() => setConfirming(false), 5000);
      }
    } else {
      onAdvance();
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -80 }}
      style={isMyTable && statusCfg ? { backgroundColor: statusCfg.bg } : undefined}
      className={`rounded-2xl border-2 ${isMyTable ? urgStyle.border : "border-sand-200"} ${!isMyTable ? "bg-sand-50/50" : ""} overflow-hidden ${
        order.isDelayed ? "border-l-4 !border-l-status-bad-500" : ""
      }${!isMyTable ? " opacity-75" : ""}`}
    >
      {/* STATUS HERO BANNER — saturated full-width strip so the
          waiter knows the order's state without parsing a tiny pill. */}
      {statusCfg && (
        <div
          className="flex items-center justify-between px-4 py-2"
          style={{ backgroundColor: statusCfg.color }}
        >
          <span className="text-white text-xs font-extrabold uppercase tracking-[0.2em]">
            {t(`waiter.status.${({pending:"new",confirmed:"confirmed",preparing:"cooking",ready:"ready",served:"served",paid:"paid"} as Record<string,string>)[order.status] ?? order.status}`)}
          </span>
          <span className="text-white/80 text-[10px] font-extrabold uppercase tracking-wider tabular-nums">
            {waitMin}m
          </span>
        </div>
      )}

      <div className="p-4">
        {/* Error Banners (block actions) */}
        {orderErrors.map((err, i) => (
          <div
            key={i}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl mb-3 text-sm font-bold ${
              err.severity === "block"
                ? "bg-status-bad-100 border-2 border-status-bad-300 text-status-bad-800"
                : "bg-status-warn-100 border-2 border-status-warn-300 text-status-warn-800"
            }`}
          >
            <span>{err.severity === "block" ? "🚫" : "⚠"}</span>
            <span>{err.message}</span>
          </div>
        ))}

        {/* Delay Banner */}
        {order.isDelayed && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-status-bad-100 border-2 border-status-bad-300 text-status-bad-800 text-sm font-bold mb-3">
            <span className="animate-pulse text-lg">⚠</span>
            DELAYED — {order.delayMinutes}m in kitchen (target: 15m)
          </div>
        )}

        {/* Header Row — table number is the hero */}
        <div className="flex items-center gap-4 mb-3">
          {/* Table / VIP block — large, dominant */}
          {order.orderType === "VIP_DINE_IN" ? (
            <div className="w-20 h-20 rounded-2xl bg-status-wait-600 flex flex-col items-center justify-center text-white flex-shrink-0">
              <span className="text-[8px] leading-none font-extrabold uppercase tracking-widest opacity-80">VIP</span>
              <span className="text-2xl leading-none font-extrabold tracking-tight mt-1">{(order.vipGuestName || "VIP").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</span>
            </div>
          ) : (
            <div
              className="w-20 h-20 rounded-2xl flex flex-col items-center justify-center flex-shrink-0"
              style={{
                backgroundColor: statusCfg?.color,
                color: "white",
              }}
            >
              <span className="text-[9px] leading-none font-extrabold uppercase tracking-widest opacity-80">Table</span>
              <span className="text-4xl leading-none font-extrabold tabular-nums tracking-tight mt-1">{order.tableNumber}</span>
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-extrabold text-text-muted uppercase tracking-widest">
              Order
            </div>
            <div className="text-2xl font-extrabold text-text-primary tabular-nums tracking-tight leading-none">
              #{order.orderNumber}
            </div>
            <div className="flex items-center gap-2 mt-2">
              <span className={`px-2 py-0.5 rounded text-[10px] font-extrabold uppercase tracking-wider ${urgStyle.badge}`}>
                {urgStyle.text.toUpperCase()}
              </span>
            </div>
          </div>
        </div>

        {/* Items */}
        <div className="space-y-1 mb-3">
          {order.items.map((item, i) => (
            <div key={i} className="flex justify-between py-1 border-b border-sand-100 last:border-0">
              <span className="text-sm text-text-primary">
                <span className="font-bold text-text-primary">{item.quantity}x</span>{" "}
                {item.name}
                {item.wasUpsell && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded bg-status-info-100 text-status-info-700 text-[8px] font-bold">
                    UPSELL
                  </span>
                )}
              </span>
              <span className="text-sm text-text-secondary tabular-nums font-semibold">
                {formatEGP(item.price * item.quantity)}
              </span>
            </div>
          ))}
        </div>

        {/* Notes */}
        {order.notes && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-status-warn-50 border border-status-warn-200 mb-3">
            <span className="text-sm">📝</span>
            <p className="text-xs text-status-warn-800 font-medium">{order.notes}</p>
          </div>
        )}

        {showNoteInput ? (
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder={t("waiter.noteForKitchen")}
              className="flex-1 px-3 py-2 rounded-xl border-2 border-sand-200 text-sm focus:border-ocean-400 focus:outline-none"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && noteText.trim()) {
                  onAddNote(noteText.trim());
                  setNoteText("");
                  setShowNoteInput(false);
                }
              }}
            />
            <button
              onClick={() => {
                if (noteText.trim()) {
                  onAddNote(noteText.trim());
                  setNoteText("");
                  setShowNoteInput(false);
                }
              }}
              className="px-3 py-2 rounded-xl bg-ocean-500 text-white text-xs font-bold"
            >
              Send
            </button>
            <button
              onClick={() => { setShowNoteInput(false); setNoteText(""); }}
              className="px-3 py-2 rounded-xl bg-sand-100 text-text-secondary text-xs font-bold"
            >
              ✕
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowNoteInput(true)}
            className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-secondary font-semibold mb-3 transition-colors"
          >
            📝 Add note for kitchen
          </button>
        )}

        {/* Footer: Total + Action */}
        <div className="flex items-center justify-between pt-3 border-t-2 border-sand-200">
          <div>
            <span className="font-semibold text-text-primary text-xl tabular-nums">
              {formatEGP(order.total)}
            </span>
            <span className="text-sm text-text-muted ml-1">{t("common.egp")}</span>
          </div>

          <div className="flex gap-2">
            {isMyTable && actionCfg && (
              <button
                onClick={handleAction}
                disabled={isBlocked}
                className={`px-5 py-3 rounded-xl text-white text-sm font-semibold transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed ${
                  confirming
                    ? "bg-status-bad-700 hover:bg-status-bad-800"
                    : actionCfg.bgColor
                }`}
              >
                {confirming ? `${t("common.confirm")} ${t("waiter.markServed")}?` : `${actionCfg.icon} ${t("waiter.markServed")}`}
              </button>
            )}

            {!isMyTable && actionCfg && (
              <span className="px-3 py-2 rounded-lg bg-sand-100 text-[10px] font-bold text-text-muted uppercase">
                {t("waiter.notYourTable")}
              </span>
            )}
          </div>
        </div>

      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════
// KITCHEN CAPACITY INDICATOR
// ═══════════════════════════════════════════════

function WaiterLoadBar({
  activeOrders,
  maxOrders,
}: {
  activeOrders: number;
  maxOrders: number;
}) {
  const { t } = useLanguage();
  const capacity = Math.min(100, Math.round((activeOrders / Math.max(1, maxOrders)) * 100));

  const barColor =
    capacity > 80
      ? "bg-status-bad-500"
      : capacity > 50
        ? "bg-status-warn-400"
        : "bg-status-good-500";

  const bgColor =
    capacity > 80
      ? "bg-status-bad-50 border-status-bad-200"
      : capacity > 50
        ? "bg-status-warn-50 border-status-warn-200"
        : "bg-status-good-50 border-status-good-200";

  return (
    <div className={`rounded-xl p-3 border-2 ${bgColor}`}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-bold text-text-secondary uppercase tracking-wide">
          My Load
        </span>
        <span className="text-xs text-text-secondary font-semibold">{activeOrders} / {maxOrders} orders</span>
      </div>
      <div className="h-2 rounded-full bg-sand-200 overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${barColor}`}
          animate={{ width: `${capacity}%` }}
          transition={{ duration: 0.5 }}
        />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-text-secondary font-semibold">{capacity}%</span>
        {capacity > 80 && (
          <span className="text-[10px] text-status-bad-600 font-bold">{t("waiter.highLoad")}</span>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// MAIN: STAFF OPERATIONAL SYSTEM
// ═══════════════════════════════════════════════

// ═══════════════════════════════════════════════
// OWNER MESSAGE TYPES
// ═══════════════════════════════════════════════

type OwnerMessage = {
  id: string;
  type: "alert" | "voice" | "command";
  from: string;
  to: string;
  text?: string;
  audio?: string;
  tableId?: number | null;
  orderId?: string;
  command?: string;
  createdAt: number;
};

// ═══════════════════════════════════════════════
// OWNER MESSAGE BANNER
// ═══════════════════════════════════════════════

function OwnerMessageBanner({
  messages,
  onDismiss,
}: {
  messages: OwnerMessage[];
  onDismiss: (id: string) => void;
}) {
  const { t } = useLanguage();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playedRef = useRef<Set<string>>(new Set());

  // Auto-play voice notes
  useEffect(() => {
    for (const msg of messages) {
      if (msg.type === "voice" && msg.audio && !playedRef.current.has(msg.id)) {
        playedRef.current.add(msg.id);
        // Play notification beep then voice
        const beep = new AudioContext();
        const osc = beep.createOscillator();
        const gain = beep.createGain();
        osc.connect(gain);
        gain.connect(beep.destination);
        osc.frequency.value = 880;
        gain.gain.value = 0.3;
        osc.start();
        osc.stop(beep.currentTime + 0.15);

        // Play voice after beep
        setTimeout(() => {
          const audio = new Audio(msg.audio!);
          audioRef.current = audio;
          audio.play().catch(() => {});
        }, 300);
      }
    }
  }, [messages]);

  if (messages.length === 0) return null;

  return (
    <div className="space-y-2 mb-3">
      <AnimatePresence>
        {messages.map((msg) => (
          <motion.div
            key={msg.id}
            initial={{ opacity: 0, y: -8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: -20 }}
            className={`flex items-center gap-3 px-4 py-3 rounded-xl border-2 ${
              msg.type === "voice"
                ? "bg-status-wait-50 border-status-wait-300"
                : msg.command === "call_waiter"
                  ? "bg-status-warn-50 border-status-warn-300"
                  : msg.command?.startsWith("shift_reminder")
                    ? "bg-status-info-50 border-status-info-300"
                    : msg.command?.startsWith("settle_cash")
                      ? "bg-status-good-50 border-status-good-300"
                      : msg.command === "prioritize"
                        ? "bg-status-bad-50 border-status-bad-300"
                        : "bg-status-warn-50 border-status-warn-300"
            }`}
          >
            <span className="text-lg flex-shrink-0">
              {msg.type === "voice" ? "🎙" : msg.command === "call_waiter" ? "🔔" : msg.command?.startsWith("shift_reminder") ? "⏰" : msg.command?.startsWith("settle_cash") ? "💰" : msg.command === "prioritize" ? "🚨" : msg.command === "send_waiter" ? "👋" : "📢"}
            </span>
            <div className="flex-1 min-w-0">
              <p className={`text-sm font-bold ${
                msg.type === "voice" ? "text-status-wait-800" : msg.command === "call_waiter" ? "text-status-warn-800" : msg.command?.startsWith("settle_cash") ? "text-status-good-800" : msg.command === "prioritize" ? "text-status-bad-800" : "text-status-warn-800"
              }`}>
                {msg.type === "voice" ? t("waiter.voiceNoteFromOwner") : msg.command === "call_waiter" ? t("waiter.guestCalling") : msg.command?.startsWith("shift_reminder") ? t("waiter.shiftReminder") : msg.command?.startsWith("settle_cash") ? t("waiter.cashSettlement") : t("waiter.ownerCommand")}
              </p>
              <p className={`text-xs ${msg.type === "voice" ? "text-status-wait-600" : msg.command === "call_waiter" ? "text-status-warn-700" : msg.command?.startsWith("settle_cash") ? "text-status-good-700" : "text-status-warn-700"}`}>
                {msg.text}
              </p>
              {msg.type === "voice" && msg.audio && (
                <button
                  onClick={() => {
                    const audio = new Audio(msg.audio!);
                    audio.play().catch(() => {});
                  }}
                  className="mt-1.5 px-3 py-1.5 rounded-lg bg-status-wait-200 text-status-wait-800 text-xs font-bold hover:bg-status-wait-300 transition"
                >
                  {t("waiter.playAgain")}
                </button>
              )}
            </div>
            <button
              onClick={() => onDismiss(msg.id)}
              className="text-xs opacity-50 hover:opacity-100 px-2 py-1 rounded-lg flex-shrink-0"
            >
              ✕
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════
// WAITER LEADERBOARD
// ═══════════════════════════════════════════════

type WaiterStat = {
  id: string;
  name: string;
  active: boolean;
  shift: number;
  sessionsHandled: number;
  ordersHandled: number;
  totalRevenue: number;
  itemsServed: number;
  avgOrderValue: number;
  avgSessionMinutes: number;
};

function Leaderboard({ staffId }: { staffId: string }) {
  const { t } = useLanguage();
  const [stats, setStats] = useState<WaiterStat[]>([]);
  const [period, setPeriod] = useState<"day" | "week" | "month">("day");
  const restaurantSlug = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";

  useEffect(() => {
    async function load() {
      try {
        const res = await staffFetch(staffId, `/api/staff/performance?restaurantId=${restaurantSlug}&period=${period}`);
        if (res.ok) {
          const data = await res.json();
          setStats(data.waiters || []);
        }
      } catch { /* silent */ }
    }
    load();
    return startPoll(load, 30000);
  }, [period, restaurantSlug, staffId]);

  const medals = ["🥇", "🥈", "🥉"];

  return (
    <div className="bg-white rounded-2xl border-2 border-sand-200 overflow-hidden">
      <div className="px-4 py-3 bg-sand-50 border-b-2 border-sand-200 flex items-center justify-between">
        <h3 className="font-extrabold text-text-primary text-sm uppercase tracking-wide">{t("waiter.leaderboard")}</h3>
        <div className="flex gap-1">
          {(["day", "week", "month"] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
                period === p ? "bg-sand-900 text-white" : "bg-sand-100 text-text-secondary"
              }`}
            >
              {p === "day" ? t("waiter.today") : p === "week" ? t("waiter.week") : t("waiter.month")}
            </button>
          ))}
        </div>
      </div>

      {stats.length === 0 ? (
        <div className="p-6 text-center text-sm text-text-muted">{t("waiter.noData")}</div>
      ) : (
        <div className="divide-y divide-sand-100">
          {stats.map((w, i) => {
            const isMe = w.id === staffId;
            return (
              <div
                key={w.id}
                className={`px-4 py-3 flex items-center gap-3 ${isMe ? "bg-status-info-50/50" : ""}`}
              >
                {/* Rank */}
                <div className="w-8 text-center flex-shrink-0">
                  {i < 3 ? (
                    <span className="text-lg">{medals[i]}</span>
                  ) : (
                    <span className="text-sm font-semibold text-text-muted">#{i + 1}</span>
                  )}
                </div>

                {/* Name + badge */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-bold ${isMe ? "text-status-info-700" : "text-text-primary"}`}>
                      {w.name}
                    </span>
                    {isMe && (
                      <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-status-info-200 text-status-info-700">{t("waiter.you")}</span>
                    )}
                    {!w.active && (
                      <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-sand-100 text-text-muted">{t("waiter.off")}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-[10px] text-text-muted">{w.ordersHandled} orders</span>
                    <span className="text-[10px] text-text-muted">{w.sessionsHandled} tables</span>
                    <span className="text-[10px] text-text-muted">{w.itemsServed} items</span>
                  </div>
                </div>

                {/* Revenue */}
                <div className="text-right flex-shrink-0">
                  <div className={`text-sm font-semibold tabular-nums ${i === 0 ? "text-status-warn-600" : "text-text-secondary"}`}>
                    {w.totalRevenue.toLocaleString()}
                  </div>
                  <div className="text-[9px] text-text-muted font-semibold">{t("common.egp")}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// WAITER ORDER PANEL — Take order on behalf of guest
// ═══════════════════════════════════════════════

type WaiterCartItem = {
  menuItemId: string;
  name: string;
  price: number;
  quantity: number;
  notes?: string;
};

function WaiterOrderPanel({
  tableNumber,
  sessionId,
  guestCount: initialGuestCount,
  onClose,
  onOrderPlaced,
}: {
  tableNumber: number;
  sessionId: string;
  guestCount: number;
  onClose: () => void;
  onOrderPlaced: () => void;
}) {
  const { t, lang } = useLanguage();
  const allItems = useMenu((s) => s.allItems);
  const categories = useMenu((s) => s.categories);
  const [activeCategory, setActiveCategory] = useState("all");
  const [cart, setCart] = useState<WaiterCartItem[]>([]);
  const [orderNotes, setOrderNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restaurantSlug = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";

  const [selectedGuest, setSelectedGuest] = useState<number | null>(null);
  const [guestCount, setGuestCount] = useState(initialGuestCount);
  const [addingGuest, setAddingGuest] = useState(false);

  const filteredItems = activeCategory === "all"
    ? allItems.filter((i) => i.available)
    : (categories.find((c) => c.slug === activeCategory)?.items.filter((i) => i.available) || []);

  const addToCart = (item: { id: string; name: string; price: number }) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.menuItemId === item.id);
      if (existing) {
        return prev.map((c) => c.menuItemId === item.id ? { ...c, quantity: c.quantity + 1 } : c);
      }
      return [...prev, { menuItemId: item.id, name: item.name, price: item.price, quantity: 1 }];
    });
  };

  const updateQty = (menuItemId: string, qty: number) => {
    if (qty <= 0) {
      setCart((prev) => prev.filter((c) => c.menuItemId !== menuItemId));
    } else {
      setCart((prev) => prev.map((c) => c.menuItemId === menuItemId ? { ...c, quantity: qty } : c));
    }
  };

  const cartTotal = cart.reduce((s, c) => s + c.price * c.quantity, 0);
  const cartItemCount = cart.reduce((s, c) => s + c.quantity, 0);

  const handleAddGuest = async () => {
    setAddingGuest(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, action: "increment_guests" }),
      });
      if (res.ok) {
        const newCount = guestCount + 1;
        setGuestCount(newCount);
        setSelectedGuest(newCount);
      }
    } catch { /* silent */ }
    setAddingGuest(false);
  };

  const handleSubmit = async () => {
    if (cart.length === 0 || submitting || !selectedGuest) return;
    setSubmitting(true);
    setError(null);

    try {
      const serviceFee = Math.round(cartTotal * 0.05);
      const total = cartTotal + serviceFee;

      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurantId: restaurantSlug,
          tableId: `table-${tableNumber}`,
          sessionId,
          guestNumber: selectedGuest,
          items: cart.map((c) => ({
            menuItemId: c.menuItemId,
            name: c.name,
            quantity: c.quantity,
            price: c.price,
            addOns: [],
            wasUpsell: false,
            notes: c.notes || "",
          })),
          subtotal: cartTotal,
          total,
          notes: orderNotes || undefined,
          language: lang,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Failed to place order");
      }

      onOrderPlaced();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to place order");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end lg:items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <motion.div
        className="relative w-full max-w-lg mx-4 mb-4 lg:mb-0 bg-white rounded-2xl border-2 border-sand-200 overflow-hidden max-h-[90vh] flex flex-col"
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-ocean-600 text-white flex items-center justify-between flex-shrink-0">
          <div>
            <h3 className="text-lg font-semibold">{t("waiter.takeOrder")}</h3>
            <p className="text-ocean-200 text-xs font-semibold">
              {t("common.table")} {tableNumber}
              {selectedGuest ? ` · G${selectedGuest}` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center text-white font-bold hover:bg-white/30"
          >
            ✕
          </button>
        </div>

        {/* Guest picker — must select a guest before ordering */}
        {!selectedGuest && (
          <div className="px-5 py-6 flex-1 flex flex-col items-center justify-center">
            <p className="text-sm font-bold text-text-secondary mb-4">{t("waiter.selectGuest")}</p>
            <div className="flex flex-wrap gap-2 justify-center mb-4">
              {Array.from({ length: guestCount }, (_, i) => i + 1).map((g) => (
                <button
                  key={g}
                  onClick={() => setSelectedGuest(g)}
                  className="w-14 h-14 rounded-xl bg-ocean-50 border-2 border-ocean-200 text-ocean-700 font-semibold text-sm hover:bg-ocean-100 transition-all active:scale-95"
                >
                  G{g}
                </button>
              ))}
            </div>
            <button
              onClick={handleAddGuest}
              disabled={addingGuest}
              className="px-5 py-2.5 rounded-xl bg-sand-100 border border-sand-200 text-text-secondary text-xs font-bold hover:bg-sand-200 transition-all active:scale-95 disabled:opacity-50"
            >
              {addingGuest ? "..." : t("waiter.addNewGuest")}
            </button>
          </div>
        )}

        {/* Category tabs */}
        {selectedGuest && (
        <div className="px-4 pt-3 pb-2 flex gap-2 overflow-x-auto no-scrollbar flex-shrink-0 border-b border-sand-100">
          <button
            onClick={() => setActiveCategory("all")}
            className={`px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
              activeCategory === "all" ? "bg-sand-900 text-white" : "bg-sand-100 text-text-secondary"
            }`}
          >
            {t("waiter.all")}
          </button>
          {categories.map((cat) => (
            <button
              key={cat.slug}
              onClick={() => setActiveCategory(cat.slug)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all ${
                activeCategory === cat.slug ? "bg-sand-900 text-white" : "bg-sand-100 text-text-secondary"
              }`}
            >
              {cat.icon ? `${cat.icon} ` : ""}{cat.name}
            </button>
          ))}
        </div>
        )}

        {/* Menu items + cart */}
        {selectedGuest && (<>
        <div className="flex-1 overflow-y-auto px-4 py-2">
          {filteredItems.length === 0 ? (
            <p className="text-center text-text-muted text-sm py-8">{t("waiter.noItemsCategory")}</p>
          ) : (
            <div className="space-y-1">
              {filteredItems.map((item) => {
                const inCart = cart.find((c) => c.menuItemId === item.id);
                return (
                  <div key={item.id} className="flex items-center gap-3 py-2.5 border-b border-sand-50">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-text-primary truncate">{item.name}</p>
                      <p className="text-xs text-text-muted font-semibold">{item.price} {t("common.egp")}</p>
                    </div>

                    {inCart ? (
                      <div className="flex items-center gap-1 bg-sand-100 rounded-full p-0.5">
                        <button
                          onClick={() => updateQty(item.id, inCart.quantity - 1)}
                          className="w-7 h-7 rounded-full bg-white flex items-center justify-center text-text-secondary text-sm font-bold shadow-sm"
                        >
                          -
                        </button>
                        <span className="w-6 text-center text-sm font-semibold text-text-primary">{inCart.quantity}</span>
                        <button
                          onClick={() => updateQty(item.id, inCart.quantity + 1)}
                          className="w-7 h-7 rounded-full bg-white flex items-center justify-center text-text-secondary text-sm font-bold shadow-sm"
                        >
                          +
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => addToCart(item)}
                        className="px-3.5 py-1.5 rounded-xl bg-ocean-600 text-white text-xs font-bold active:scale-95 transition-transform"
                      >
                        + Add
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Cart summary + submit */}
        {cart.length > 0 && (
          <div className="flex-shrink-0 border-t-2 border-sand-200 bg-sand-50 p-4">
            {/* Cart items summary */}
            <div className="space-y-1 mb-3 max-h-32 overflow-y-auto">
              {cart.map((item) => (
                <div key={item.menuItemId} className="flex justify-between text-xs">
                  <span className="text-text-secondary">
                    <span className="font-bold">{item.quantity}x</span> {item.name}
                  </span>
                  <span className="text-text-secondary tabular-nums font-semibold">{formatEGP(item.price * item.quantity)}</span>
                </div>
              ))}
            </div>

            {/* Notes */}
            <input
              type="text"
              value={orderNotes}
              onChange={(e) => setOrderNotes(e.target.value)}
              placeholder={t("waiter.orderNotes")}
              className="w-full px-3 py-2 rounded-xl border border-sand-200 text-sm mb-3 focus:border-ocean-300 focus:outline-none"
            />

            {error && (
              <p className="text-xs text-status-bad-600 font-bold mb-2">{error}</p>
            )}

            {/* Total + Submit */}
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm text-text-secondary font-semibold">{cartItemCount} items</span>
              <span className="text-lg font-semibold text-text-primary">{formatEGP(cartTotal)} {t("common.egp")}</span>
            </div>

            <button
              onClick={handleSubmit}
              disabled={submitting}
              className={`w-full py-3.5 rounded-xl text-white text-sm font-semibold transition-all active:scale-95 ${
                submitting ? "bg-ocean-400 cursor-wait" : "bg-ocean-600 hover:bg-ocean-700"
              }`}
            >
              {submitting ? t("waiter.sendingToKitchen") : `${t("waiter.sendToKitchen")} — ${formatEGP(cartTotal)} ${t("common.egp")}`}
            </button>
          </div>
        )}
        </>)}
      </motion.div>
    </motion.div>
  );
}


// ═══════════════════════════════════════════════
// SESSION INFO PANEL — Shows active sessions assigned to waiter
// ═══════════════════════════════════════════════

type SessionInfo = {
  id: string;
  tableNumber: number | null;
  guestCount: number;
  waiterId?: string;
  waiterName?: string;
  openedAt: string;
  closedAt?: string | null;
  status: string;
  orderTotal?: number;
  cashTotal?: number;
  isCurrentShift?: boolean;
  orderType?: string;
  vipGuestName?: string | null;
};

const WAITER_COLORS = [
  { bg: "bg-status-info-50", border: "border-status-info-300", text: "text-status-info-700", dot: "bg-status-info-400", label: "bg-status-info-100 text-status-info-700" },
  { bg: "bg-status-wait-50", border: "border-status-wait-300", text: "text-status-wait-700", dot: "bg-status-wait-400", label: "bg-status-wait-100 text-status-wait-700" },
  { bg: "bg-status-warn-50", border: "border-status-warn-300", text: "text-status-warn-700", dot: "bg-status-warn-400", label: "bg-status-warn-100 text-status-warn-700" },
  { bg: "bg-status-bad-50", border: "border-status-bad-300", text: "text-status-bad-700", dot: "bg-status-bad-400", label: "bg-status-bad-100 text-status-bad-700" },
  { bg: "bg-teal-50", border: "border-teal-300", text: "text-teal-700", dot: "bg-teal-400", label: "bg-teal-100 text-teal-700" },
];

function SessionsPanel({ sessions, now, staffId }: { sessions: SessionInfo[]; now: number; staffId?: string }) {
  const { t } = useLanguage();
  const [showPrevShift, setShowPrevShift] = useState(false);

  // Build waiter → color map from unique waiter IDs
  const waiterColorMap = useMemo(() => {
    const map = new Map<string, typeof WAITER_COLORS[0]>();
    const ids = [...new Set(sessions.filter((s) => s.waiterId).map((s) => s.waiterId!))];
    ids.forEach((id, i) => map.set(id, WAITER_COLORS[i % WAITER_COLORS.length]));
    return map;
  }, [sessions]);

  // Split: active (OPEN), closed this shift, previous shift
  const open = sessions.filter((s) => s.status === "OPEN");
  const tableSessions = open.filter((s) => !s.orderType || s.orderType === "TABLE");
  const vipDineIn = open.filter((s) => s.orderType === "VIP_DINE_IN");
  const closedThisShift = sessions.filter((s) => s.status === "CLOSED" && s.isCurrentShift && s.orderType !== "DELIVERY");
  const prevShift = sessions.filter((s) => !s.isCurrentShift && s.orderType !== "DELIVERY");

  const mySessions = staffId ? tableSessions.filter((s) => s.waiterId === staffId) : [];
  const otherAssigned = staffId ? tableSessions.filter((s) => s.waiterId && s.waiterId !== staffId) : [];
  const unassigned = tableSessions.filter((s) => !s.waiterId);

  if (sessions.length === 0) {
    return (
      <div className="bg-white rounded-2xl border-2 border-sand-200 p-4 text-center">
        <p className="text-text-secondary text-sm">{t("waiter.noSessionsToday")}</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border-2 border-sand-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-sand-100">
        <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
          {t("waiter.sessions")}
          {open.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-status-good-100 text-status-good-700 text-[10px] font-bold">
              {open.length} {t("waiter.active")}
            </span>
          )}
        </h3>
      </div>
      <div className="max-h-[350px] overflow-y-auto">
        {/* My active sessions (highlighted with my color) */}
        {mySessions.length > 0 && (() => {
          const myColor = staffId ? waiterColorMap.get(staffId) : WAITER_COLORS[0];
          return (
            <>
              <div className={`px-4 py-1.5 ${myColor?.bg || "bg-status-info-50"} border-b border-sand-100`}>
                <span className={`text-[10px] font-bold ${myColor?.text || "text-status-info-700"}`}>{t("waiter.myTables")} ({mySessions.length})</span>
              </div>
              {mySessions.map((session) => {
                const elapsed = Math.round((now - new Date(session.openedAt).getTime()) / 60000);
                return (
                  <div key={session.id} className={`px-4 py-2.5 border-b border-sand-50 flex items-center gap-3 ${myColor?.bg || "bg-status-info-50"}/30`}>
                    <div className={`w-9 h-9 rounded-xl ${myColor?.bg || "bg-status-info-50"} border-2 ${myColor?.border || "border-status-info-300"} flex items-center justify-center text-xs font-semibold ${myColor?.text || "text-status-info-700"}`}>
                      {session.tableNumber}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-bold text-text-primary">{t("common.table")} {session.tableNumber}</span>
                        <span className="text-[9px] text-text-muted">{session.guestCount} {session.guestCount !== 1 ? t("common.guests") : t("common.guest")}</span>
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-[10px] text-text-muted">{elapsed}m</span>
                        {(session.orderTotal ?? 0) > 0 && (
                          <span className="text-[10px] text-status-good-600 font-bold">{session.orderTotal} {t("common.egp")}</span>
                        )}
                      </div>
                    </div>
                    <span className={`w-2 h-2 rounded-full ${myColor?.dot || "bg-status-info-400"} animate-pulse`} />
                  </div>
                );
              })}
            </>
          );
        })()}

        {/* Other waiters' active sessions (color-coded per waiter) */}
        {otherAssigned.length > 0 && (
          <>
            <div className="px-4 py-1.5 bg-sand-50 border-b border-sand-100">
              <span className="text-[10px] font-bold text-text-muted">{t("waiter.otherWaiters")} ({otherAssigned.length})</span>
            </div>
            {otherAssigned.map((session) => {
              const elapsed = Math.round((now - new Date(session.openedAt).getTime()) / 60000);
              const wc = session.waiterId ? waiterColorMap.get(session.waiterId) : null;
              return (
                <div key={session.id} className="px-4 py-2.5 border-b border-sand-50 flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl ${wc?.bg || "bg-sand-50"} border-2 ${wc?.border || "border-sand-200"} flex items-center justify-center text-xs font-semibold ${wc?.text || "text-text-secondary"}`}>
                    {session.tableNumber}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-text-primary">{t("common.table")} {session.tableNumber}</span>
                      <span className="text-[9px] text-text-muted">{session.guestCount} {session.guestCount !== 1 ? t("common.guests") : t("common.guest")}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] text-text-muted">{elapsed}m</span>
                      {session.waiterName && (
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${wc?.label || "bg-sand-100 text-text-secondary"}`}>{session.waiterName}</span>
                      )}
                    </div>
                  </div>
                  <span className={`w-2 h-2 rounded-full ${wc?.dot || "bg-sand-300"} animate-pulse`} />
                </div>
              );
            })}
          </>
        )}

        {/* Unassigned sessions (warning) */}
        {unassigned.length > 0 && (
          <>
            <div className="px-4 py-1.5 bg-status-bad-50 border-b border-status-bad-100">
              <span className="text-[10px] font-bold text-status-bad-600">{t("waiter.unassigned")} ({unassigned.length})</span>
            </div>
            {unassigned.map((session) => {
              const elapsed = Math.round((now - new Date(session.openedAt).getTime()) / 60000);
              return (
                <div key={session.id} className="px-4 py-2.5 border-b border-status-bad-50 flex items-center gap-3 bg-status-bad-50/30">
                  <div className="w-9 h-9 rounded-xl bg-status-bad-50 border-2 border-status-bad-300 flex items-center justify-center text-xs font-semibold text-status-bad-700">
                    {session.tableNumber}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-bold text-text-primary">{t("common.table")} {session.tableNumber}</span>
                      <span className="text-[9px] text-status-bad-400 font-bold">{t("waiter.noWaiter")}</span>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px] text-text-muted">{elapsed}m</span>
                      {(session.orderTotal ?? 0) > 0 && (
                        <span className="text-[10px] text-status-good-600 font-bold">{session.orderTotal} {t("common.egp")}</span>
                      )}
                    </div>
                  </div>
                  <span className="w-2 h-2 rounded-full bg-status-bad-400 animate-pulse" />
                </div>
              );
            })}
          </>
        )}

        {/* VIP Dine-In — My VIPs */}
        {(() => {
          const myVip = staffId ? vipDineIn.filter((s) => s.waiterId === staffId) : [];
          const otherVip = staffId ? vipDineIn.filter((s) => s.waiterId && s.waiterId !== staffId) : [];
          const unassignedVip = vipDineIn.filter((s) => !s.waiterId);
          const myColor = staffId ? waiterColorMap.get(staffId) : WAITER_COLORS[0];
          return (
            <>
              {myVip.length > 0 && (
                <>
                  <div className={`px-4 py-1.5 ${myColor?.bg || "bg-status-info-50"} border-b border-status-warn-100`}>
                    <span className={`text-[10px] font-bold ${myColor?.text || "text-status-info-700"}`}>{t("waiter.myVipGuests")} ({myVip.length})</span>
                  </div>
                  {myVip.map((session) => {
                    const elapsed = Math.round((now - new Date(session.openedAt).getTime()) / 60000);
                    const initials = (session.vipGuestName || "V").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                    return (
                      <div key={session.id} className={`px-4 py-2.5 border-b border-status-warn-50 flex items-center gap-3 ${myColor?.bg || "bg-status-info-50"}/30`}>
                        <div className={`w-9 h-9 rounded-xl bg-status-wait-600 border-2 border-status-wait-700 flex items-center justify-center text-[11px] font-semibold text-white`}>
                          {initials}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-text-primary truncate">{session.vipGuestName || t("waiter.vipGuest")}</span>
                            <span className="text-[9px] text-status-wait-600 font-bold">{"\u{1F451}"} VIP</span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[10px] text-text-muted">{elapsed}m</span>
                            {(session.orderTotal ?? 0) > 0 && (
                              <span className="text-[10px] text-status-good-600 font-bold">{session.orderTotal} {t("common.egp")}</span>
                            )}
                          </div>
                        </div>
                        <span className={`w-2 h-2 rounded-full ${myColor?.dot || "bg-status-info-400"} animate-pulse`} />
                      </div>
                    );
                  })}
                </>
              )}
              {otherVip.length > 0 && (
                <>
                  <div className="px-4 py-1.5 bg-sand-50 border-b border-sand-100">
                    <span className="text-[10px] font-bold text-text-muted">{t("waiter.otherVip")} ({otherVip.length})</span>
                  </div>
                  {otherVip.map((session) => {
                    const elapsed = Math.round((now - new Date(session.openedAt).getTime()) / 60000);
                    const initials = (session.vipGuestName || "V").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                    const wc = session.waiterId ? waiterColorMap.get(session.waiterId) : null;
                    return (
                      <div key={session.id} className="px-4 py-2.5 border-b border-sand-50 flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-xl bg-status-wait-500 border-2 border-status-wait-600 flex items-center justify-center text-[11px] font-semibold text-white`}>
                          {initials}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-text-primary truncate">{session.vipGuestName || t("waiter.vipGuest")}</span>
                            <span className="text-[9px] text-status-wait-500 font-bold">{"\u{1F451}"} VIP</span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[10px] text-text-muted">{elapsed}m</span>
                            {session.waiterName && (
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${wc?.label || "bg-sand-100 text-text-secondary"}`}>{session.waiterName}</span>
                            )}
                          </div>
                        </div>
                        <span className={`w-2 h-2 rounded-full ${wc?.dot || "bg-sand-300"} animate-pulse`} />
                      </div>
                    );
                  })}
                </>
              )}
              {unassignedVip.length > 0 && (
                <>
                  <div className="px-4 py-1.5 bg-status-bad-50 border-b border-status-bad-100">
                    <span className="text-[10px] font-bold text-status-bad-600">{t("waiter.vipNoWaiter")} ({unassignedVip.length})</span>
                  </div>
                  {unassignedVip.map((session) => {
                    const elapsed = Math.round((now - new Date(session.openedAt).getTime()) / 60000);
                    const initials = (session.vipGuestName || "V").split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
                    return (
                      <div key={session.id} className="px-4 py-2.5 border-b border-status-bad-50 flex items-center gap-3 bg-status-bad-50/30">
                        <div className="w-9 h-9 rounded-xl bg-status-bad-500 border-2 border-status-bad-600 flex items-center justify-center text-[11px] font-semibold text-white">
                          {initials}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold text-text-primary truncate">{session.vipGuestName || t("waiter.vipGuest")}</span>
                            <span className="text-[9px] text-status-bad-500 font-bold">VIP · {t("waiter.noWaiter")}</span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[10px] text-text-muted">{elapsed}m</span>
                            {(session.orderTotal ?? 0) > 0 && (
                              <span className="text-[10px] text-status-good-600 font-bold">{session.orderTotal} {t("common.egp")}</span>
                            )}
                          </div>
                        </div>
                        <span className="w-2 h-2 rounded-full bg-status-bad-400 animate-pulse" />
                      </div>
                    );
                  })}
                </>
              )}
            </>
          );
        })()}

        {/* Closed sessions this shift — collapsed */}
        {closedThisShift.length > 0 && (
          <details className="border-t border-sand-100">
            <summary className="px-4 py-2.5 text-[10px] text-text-muted font-bold cursor-pointer hover:text-text-secondary flex items-center justify-between">
              <span>{closedThisShift.length} {t("waiter.closedThisShift")}</span>
              <span className="text-status-good-500 font-bold">
                {closedThisShift.reduce((s, se) => s + (se.orderTotal || 0), 0)} {t("common.egp")}
              </span>
            </summary>
            {closedThisShift.map((session) => {
              const isVip = session.orderType === "VIP_DINE_IN";
              const label = isVip ? (session.vipGuestName || "VIP") : `T${session.tableNumber}`;
              return (
                <div key={session.id} className="px-4 py-2 border-b border-sand-50 flex items-center gap-3 opacity-60">
                  <div className={`w-8 h-8 rounded-lg border flex items-center justify-center text-[10px] font-bold ${isVip ? "bg-status-wait-50 border-status-wait-200 text-status-wait-600" : "bg-sand-50 border-sand-200 text-text-muted"}`}>
                    {isVip ? "\u{1F451}" : session.tableNumber}
                  </div>
                  <div className="flex-1">
                    <span className="text-[10px] text-text-secondary">
                      {label} · {session.guestCount}g
                      {session.waiterName && ` · ${session.waiterName}`}
                    </span>
                  </div>
                  <span className="text-[10px] text-text-muted font-semibold">{session.orderTotal || 0} {t("common.egp")}</span>
                </div>
              );
            })}
          </details>
        )}

        {/* Previous shift sessions — hidden by default behind button */}
        {prevShift.length > 0 && (
          <>
            <button
              onClick={() => setShowPrevShift(!showPrevShift)}
              className="w-full px-4 py-2.5 border-t border-sand-100 text-[10px] text-text-muted font-bold hover:text-text-secondary hover:bg-sand-50 transition-colors flex items-center justify-between"
            >
              <span>{showPrevShift ? "▼" : "▶"} {t("waiter.prevShift")} ({prevShift.length})</span>
              <span className="text-text-muted">
                {prevShift.reduce((s, se) => s + (se.orderTotal || 0), 0)} {t("common.egp")}
              </span>
            </button>
            {showPrevShift && (
              <div className="bg-sand-50/50">
                {prevShift.map((session) => {
                  const isVip = session.orderType === "VIP_DINE_IN";
                  const label = isVip ? (session.vipGuestName || "VIP") : `T${session.tableNumber}`;
                  return (
                    <div key={session.id} className="px-4 py-2 border-b border-sand-50 flex items-center gap-3 opacity-40">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[9px] font-bold ${isVip ? "bg-status-wait-50 text-status-wait-500" : "bg-sand-100 text-text-muted"}`}>
                        {isVip ? "\u{1F451}" : session.tableNumber}
                      </div>
                      <div className="flex-1">
                        <span className="text-[9px] text-text-muted">
                          {label} · {session.guestCount}g · {session.waiterName || "—"}
                        </span>
                      </div>
                      <span className="text-[9px] text-text-muted">{session.orderTotal || 0}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* No active sessions message */}
        {open.length === 0 && (
          <div className="px-4 py-4 text-center">
            <p className="text-xs text-text-muted">{t("waiter.noActiveTables")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// STAFF PIN LOGIN
// ═══════════════════════════════════════════════

type LoggedInStaff = { id: string; name: string; role: string; shift: number; loginAt?: number };

function StaffLoginScreen({ onLogin }: { onLogin: (staff: LoggedInStaff) => void }) {
  const { t } = useLanguage();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const restaurantSlug = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";

  const handleSubmit = async () => {
    if (pin.length < 4) { setError(t("login.pinTooShort")); return; }
    setError(""); setLoading(true);
    try {
      const res = await fetch("/api/staff/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, restaurantId: restaurantSlug }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || t("login.invalidPin"));
        setLoading(false);
        return;
      }
      const staff = await res.json();
      onLogin(staff);
    } catch {
      setError(t("login.networkError"));
    }
    setLoading(false);
  };

  const handleKeyPress = (digit: string) => {
    if (pin.length < 6) {
      setPin((p) => p + digit);
      setError("");
    }
  };

  const handleBackspace = () => setPin((p) => p.slice(0, -1));

  return (
    <div className="min-h-dvh bg-sand-100 flex items-center justify-center px-4">
      <motion.div
        className="w-full max-w-sm bg-white rounded-3xl shadow-xl p-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-sand-900 flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl text-white font-semibold">S</span>
          </div>
          <h1 className="text-xl font-semibold text-text-primary">{t("waiter.login")}</h1>
          <p className="text-sm text-text-secondary mt-1">{t("waiter.loginDesc")}</p>
        </div>

        {/* PIN display */}
        <div className="flex justify-center gap-3 mb-6">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`w-12 h-14 rounded-xl border-2 flex items-center justify-center text-xl font-semibold transition-all ${
                pin.length > i
                  ? "border-sand-900 bg-sand-50 text-text-primary"
                  : "border-sand-200 bg-white text-transparent"
              }`}
            >
              {pin.length > i ? "●" : "○"}
            </div>
          ))}
        </div>

        {/* Error */}
        {error && (
          <motion.p
            className="text-center text-status-bad-600 text-sm font-semibold mb-4"
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
          >
            {error}
          </motion.p>
        )}

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-2 mb-6">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((key) => (
            <button
              key={key || "empty"}
              onClick={() => {
                if (key === "⌫") handleBackspace();
                else if (key) handleKeyPress(key);
              }}
              disabled={!key}
              className={`h-14 rounded-xl text-xl font-bold transition-all active:scale-95 ${
                key === "⌫"
                  ? "bg-sand-100 text-text-secondary hover:bg-sand-200"
                  : key
                  ? "bg-sand-50 text-text-primary hover:bg-sand-100"
                  : "invisible"
              }`}
            >
              {key}
            </button>
          ))}
        </div>

        {/* Submit */}
        <button
          onClick={handleSubmit}
          disabled={pin.length < 4 || loading}
          className={`w-full py-4 rounded-2xl text-lg font-bold transition-all active:scale-[0.98] ${
            pin.length >= 4 && !loading
              ? "bg-sand-900 text-white hover:bg-sand-800"
              : "bg-sand-200 text-text-muted cursor-not-allowed"
          }`}
        >
          {loading ? t("login.verifying") : t("waiter.clockIn")}
        </button>

        <a href="/" className="block text-center text-sm text-text-muted mt-4 hover:text-text-secondary">
          ← Back to home
        </a>
      </motion.div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// PAGE WRAPPER WITH LOGIN
// ═══════════════════════════════════════════════

export default function WaiterPage() {
  const [loggedInStaff, setLoggedInStaff] = useState<LoggedInStaff | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Restore session after hydration to avoid SSR mismatch / double login flash
  // Session persists for 16 hours to survive mid-shift phone sleep/lock
  useEffect(() => {
    try {
      const saved = localStorage.getItem("waiter_staff");
      if (saved) {
        const parsed = JSON.parse(saved);
        const loginAt = parsed.loginAt || 0;
        const SESSION_DURATION = 16 * 60 * 60 * 1000; // 16 hours
        if (Date.now() - loginAt < SESSION_DURATION) {
          setLoggedInStaff(parsed);
        } else {
          localStorage.removeItem("waiter_staff");
        }
      }
    } catch { /* silent */ }
    setHydrated(true);
  }, []);

  // Keep screen awake during shift (prevents tab kill on mobile)
  useEffect(() => {
    if (!loggedInStaff) return;
    let wakeLock: WakeLockSentinel | null = null;
    async function acquire() {
      try {
        if ("wakeLock" in navigator) {
          wakeLock = await navigator.wakeLock.request("screen");
        }
      } catch { /* not critical */ }
    }
    acquire();
    const onVisibility = () => { if (document.visibilityState === "visible") acquire(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      wakeLock?.release().catch(() => {});
    };
  }, [loggedInStaff]);

  const handleLogin = useCallback((staff: LoggedInStaff) => {
    if (staff.role === "KITCHEN") {
      window.location.href = "/kitchen";
      return;
    }
    if (staff.role === "CASHIER") {
      window.location.href = "/cashier";
      return;
    }
    const staffWithLogin = { ...staff, loginAt: Date.now() };
    localStorage.setItem("waiter_staff", JSON.stringify(staffWithLogin));
    setLoggedInStaff(staffWithLogin);
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem("waiter_staff");
    setLoggedInStaff(null);
  }, []);

  if (!hydrated) {
    return (
      <div className="min-h-dvh bg-sand-100 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-sand-300 border-t-ocean-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!loggedInStaff) {
    return <StaffLoginScreen onLogin={handleLogin} />;
  }

  return <StaffSystem loggedInStaff={loggedInStaff} onLogout={handleLogout} />;
}

function StaffSystem({ loggedInStaff, onLogout }: { loggedInStaff: LoggedInStaff; onLogout: () => void }) {
  const { lang, toggleLang, t, dir } = useLanguage();
  const orders = usePerception((s) => s.orders);
  const tables = usePerception((s) => s.tableStates);
  const kitchen = usePerception((s) => s.kitchen);
  const updateOrder = usePerception((s) => s.updateOrder);
  const updateTable = usePerception((s) => s.updateTable);

  const [filter, setFilter] = useState<string>("all");
  const [selectedTable, setSelectedTable] = useState<TableState | null>(null);
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(Date.now());
  const [showSchedule, setShowSchedule] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [ownerMessages, setOwnerMessages] = useState<OwnerMessage[]>([]);
  const [dismissedMessages, setDismissedMessages] = useState<Set<string>>(new Set());
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [waiterOrderTarget, setWaiterOrderTarget] = useState<{ tableNumber: number; sessionId: string; guestCount: number } | null>(null);
  const lastPollRef = useRef(Date.now());
  const [shiftInfo, setShiftInfo] = useState(() => getShiftTimer(loggedInStaff.shift));
  const seenOrderIdsRef = useRef<Set<string>>(new Set());
  const seenReadyIdsRef = useRef<Set<string>>(new Set());
  const seenMessageIdsRef = useRef<Set<string>>(new Set());
  const prevSessionTableMapRef = useRef<Map<string, number>>(new Map());
  const [tableMoveAlerts, setTableMoveAlerts] = useState<StaffAlert[]>([]);
  const [waiterCapacity, setWaiterCapacity] = useState(15);

  useEffect(() => {
    fetch(`/api/restaurant?slug=${process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab"}`)
      .then((r) => r.json())
      .then((d) => { if (d.waiterCapacity) setWaiterCapacity(d.waiterCapacity); })
      .catch(() => {});
  }, []);

  // Update shift timer every second
  useEffect(() => {
    const tick = () => setShiftInfo(getShiftTimer(loggedInStaff.shift));
    const shiftInterval = setInterval(tick, 1000);
    // Re-check shift immediately when tab regains focus (covers idle/sleep gaps)
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(shiftInterval); document.removeEventListener("visibilitychange", onVisible); };
  }, [loggedInStaff.shift]);

  const isOnShift = loggedInStaff.shift === 0 || shiftInfo.isOnShift;

  // Request notification permission on mount
  useEffect(() => {
    requestNotificationPermission();
  }, []);

  // Live data hook — polls /api/live-snapshot
  useLiveData(loggedInStaff.id);

  // Initialize menu store
  useEffect(() => { useMenu.getState().initialize(); }, []);

  // Tick clock
  useEffect(() => {
    const clockInterval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(clockInterval);
  }, []);

  // Subscribe to push notifications. `lang` in deps so flipping the
  // language toggle updates the server-side subscription record, and
  // future pushes land in the new language.
  useEffect(() => {
    import("@/lib/push-client").then(({ subscribeToPush }) => {
      const restaurantSlug = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";
      subscribeToPush(loggedInStaff.id, loggedInStaff.role, restaurantSlug, lang as "en" | "ar").catch(() => {});
    });
  }, [loggedInStaff.id, loggedInStaff.role, lang]);

  // Poll for owner messages (voice notes, commands, alerts)
  useEffect(() => {
    const restaurantSlug = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";
    const staffId = loggedInStaff.id;
    return startPoll(() => {
      fetch(`/api/messages?since=${lastPollRef.current}&to=${staffId}&restaurantId=${restaurantSlug}`)
        .then((res) => res.json())
        .then((msgs: OwnerMessage[]) => {
          if (msgs.length > 0) {
            setOwnerMessages((prev) => {
              const existingIds = new Set(prev.map((m) => m.id));
              const newMsgs = msgs.filter((m: OwnerMessage) => !existingIds.has(m.id));
              return newMsgs.length > 0 ? [...prev, ...newMsgs] : prev;
            });
            lastPollRef.current = Math.max(...msgs.map((m: OwnerMessage) => m.createdAt));
          }
        })
        .catch(() => {});
    }, 4000);
  }, [loggedInStaff.id]);

  // Poll for sessions (batch endpoint — single request instead of 14)
  useEffect(() => {
    const restaurantSlug = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";
    async function fetchSessions() {
      try {
        const res = await staffFetch(loggedInStaff.id, `/api/sessions/all?restaurantId=${restaurantSlug}`, { method: "GET" });
        if (res.ok) {
          const data = await res.json();
          setSessions(data.sessions || []);
        }
      } catch { /* silent */ }
    }
    fetchSessions();
    return startPoll(fetchSessions, 10000);
  }, [loggedInStaff.id]);

  const visibleOwnerMessages = ownerMessages.filter((m) => !dismissedMessages.has(m.id));

  // ─── Push Notifications ──────────────────────────
  // Notify on new orders for my tables
  useEffect(() => {
    const myTables = new Set(
      sessions.filter((s) => s.waiterId === loggedInStaff.id && s.status === "OPEN").map((s) => s.tableNumber)
    );
    for (const o of orders) {
      if (o.tableNumber == null || !myTables.has(o.tableNumber)) continue;
      if (o.status === "ready" && !seenReadyIdsRef.current.has(o.id)) {
        seenReadyIdsRef.current.add(o.id);
        notifyOrderReady(o.tableNumber, o.orderNumber);
      }
    }
  }, [orders, sessions, loggedInStaff.id]);

  // Notify on owner messages
  useEffect(() => {
    for (const m of ownerMessages) {
      if (seenMessageIdsRef.current.has(m.id)) continue;
      seenMessageIdsRef.current.add(m.id);
      if (m.type === "voice") {
        notifyVoiceNote("Owner");
      } else {
        notifyOwnerCommand(m.text || "New command from owner");
      }
    }
  }, [ownerMessages]);

  // Detect table moves from session polling
  useEffect(() => {
    const prevMap = prevSessionTableMapRef.current;
    const newAlerts: StaffAlert[] = [];
    for (const sess of sessions) {
      if (sess.status !== "OPEN" || sess.tableNumber == null) continue;
      const prevTable = prevMap.get(sess.id);
      if (prevTable !== undefined && prevTable !== sess.tableNumber) {
        newAlerts.push({
          id: `table-move-${sess.id}-${sess.tableNumber}`,
          type: "table_move",
          message: `Table ${prevTable} → Table ${sess.tableNumber} — guest moved, serve new table`,
          tableId: sess.tableNumber,
          priority: 1,
          timestamp: Date.now(),
        });
      }
    }
    // Update the map
    const newMap = new Map<string, number>();
    for (const sess of sessions) {
      if (sess.status === "OPEN" && sess.tableNumber != null) newMap.set(sess.id, sess.tableNumber);
    }
    prevSessionTableMapRef.current = newMap;
    if (newAlerts.length > 0) {
      // Deduplicate — don't add if same id already exists
      setTableMoveAlerts((prev) => {
        const existingIds = new Set(prev.map((a) => a.id));
        const fresh = newAlerts.filter((a) => !existingIds.has(a.id));
        return fresh.length > 0 ? [...prev, ...fresh] : prev;
      });
      // Auto-dismiss after 60s
      const alertIds = newAlerts.map((a) => a.id);
      setTimeout(() => {
        setTableMoveAlerts((prev) => prev.filter((a) => !alertIds.includes(a.id)));
      }, 60000);
    }
  }, [sessions]); // Only re-run when sessions change, not on every tick

  // ─── My tables (for action permissions) ──────
  const myTableNumbers = new Set(
    sessions
      .filter((s) => s.status === "OPEN" && s.waiterId === loggedInStaff.id && s.tableNumber != null)
      .map((s) => s.tableNumber as number)
  );
  const mySessionIds = new Set(
    sessions
      .filter((s) => s.status === "OPEN" && s.waiterId === loggedInStaff.id)
      .map((s) => s.id)
  );

  // ─── ALL real orders (not filtered by session — so tabs populate fully) ──────
  const allRealOrders = orders;

  // ─── Error Detection ──────────────────────
  const validationErrors = detectErrors(allRealOrders, tables);

  // ─── Alert Generation ─────────────────────
  const allAlerts = [
    ...generateStaffAlerts(allRealOrders, tables, kitchen, validationErrors, now),
    ...tableMoveAlerts,
  ];
  const visibleAlerts = allAlerts.filter((a) => !dismissedAlerts.has(a.id));

  // ─── Order Priority Sort ──────────────────
  const activeOrders = allRealOrders
    .filter((o) => o.status !== "paid" && o.status !== "cancelled")
    .map((o) => ({
      order: o,
      urgency: computeUrgency(o, now),
    }))
    .sort((a, b) => {
      // 1. Status priority (ready first, then pending, etc.)
      const statusPriority = STATUS_CONFIG[a.order.status]?.priority ?? 5;
      const statusPriorityB = STATUS_CONFIG[b.order.status]?.priority ?? 5;
      if (statusPriority !== statusPriorityB) return statusPriority - statusPriorityB;

      // 2. Urgency (critical first)
      const urgencyOrder: Record<UrgencyLevel, number> = { critical: 0, attention: 1, normal: 2 };
      if (urgencyOrder[a.urgency] !== urgencyOrder[b.urgency])
        return urgencyOrder[a.urgency] - urgencyOrder[b.urgency];

      // 3. Delayed first
      if (a.order.isDelayed !== b.order.isDelayed) return a.order.isDelayed ? -1 : 1;

      // 4. Older first
      return a.order.createdAt - b.order.createdAt;
    });

  const filtered =
    filter === "all"
      ? activeOrders
      : activeOrders.filter((o) => o.order.status === filter);

  // ─── Actions ──────────────────────────────
  const advanceOrder = useCallback(
    (orderId: string) => {
      const order = orders.find((o) => o.id === orderId);
      if (!order) return;

      const action = ACTION_CONFIG[order.status];
      if (!action) return;

      // Error prevention: block if there are blocking errors
      const orderErrors = validationErrors.filter(
        (e) => e.orderId === orderId && e.severity === "block"
      );
      if (orderErrors.length > 0) return;

      const updates: Partial<LiveOrder> = { status: action.nextStatus as LiveOrder["status"] };
      if (action.nextStatus === "served") updates.servedAt = Date.now();
      updateOrder(orderId, updates);

      // Broadcast via API so kitchen + other tabs see the change
      staffFetch(loggedInStaff.id, `/api/orders/${orderId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: action.nextStatus.toUpperCase(), restaurantId: useMenu.getState().restaurantId || "demo", staffId: loggedInStaff.id }),
      }).catch((err) => console.error("Failed to update order status:", err));
    },
    [orders, updateOrder, validationErrors, loggedInStaff.id]
  );

  const addNoteToOrder = useCallback(
    (orderId: string, note: string) => {
      const order = orders.find((o) => o.id === orderId);
      if (!order) return;

      const existingNotes = order.notes ? `${order.notes}\n${note}` : note;
      updateOrder(orderId, { notes: existingNotes } as Partial<LiveOrder>);

      staffFetch(loggedInStaff.id, `/api/orders/${orderId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: order.status.toUpperCase(), notes: existingNotes, restaurantId: useMenu.getState().restaurantId || "demo", staffId: loggedInStaff.id }),
      }).catch((err) => console.error("Failed to add note:", err));
    },
    [orders, updateOrder, loggedInStaff.id]
  );

  const handleUpdateTableStatus = useCallback(
    (tableId: number, status: TableState["status"]) => {
      const update: Partial<TableState> = { status };
      if (status === "empty") {
        update.guestCount = 0;
        update.currentOrderValue = 0;
        update.itemsOrdered = 0;
        update.itemsViewed = 0;
        update.engagementScore = 0;
      }
      updateTable(tableId, update);
    },
    [updateTable]
  );

  // ─── Counts (all derived from activeOrders for consistency) ───────────────────────────────
  const pendingCount = activeOrders.filter((o) => o.order.status === "pending").length;
  const readyCount = activeOrders.filter((o) => o.order.status === "ready").length;
  const preparingCount = activeOrders.filter((o) => o.order.status === "preparing").length;
  const servedCount = activeOrders.filter((o) => o.order.status === "served").length;

  // "My Load" counts only orders for tables/sessions assigned to me.
  // The filter tabs above intentionally stay restaurant-wide so a waiter
  // sees what the floor is dealing with, but the load gauge is personal.
  const myActiveOrderCount = activeOrders.filter(({ order }) => {
    if (order.sessionId && mySessionIds.has(order.sessionId)) return true;
    if (order.tableNumber != null && myTableNumbers.has(order.tableNumber)) return true;
    return false;
  }).length;
  const delayedCount = activeOrders.filter((o) => o.order.isDelayed).length;
  const criticalCount = activeOrders.filter((o) => o.urgency === "critical").length;

  return (
    <div className="min-h-dvh bg-sand-100" dir={dir}>
      {/* ═══ OFF-SHIFT OVERLAY ═══ */}
      {!isOnShift && loggedInStaff.shift !== 0 && (
        <div className="fixed inset-0 z-50 bg-sand-900/80 flex items-center justify-center px-4">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl">
            <div className="w-16 h-16 rounded-2xl bg-status-bad-100 flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">🕐</span>
            </div>
            <h2 className="text-xl font-semibold text-text-primary mb-2">{t("waiter.offShift")}</h2>
            <p className="text-sm text-text-secondary mb-1">{getShiftLabel(loggedInStaff.shift)}</p>
            <p className="text-lg font-bold text-status-bad-600 mb-4">{shiftInfo.label}</p>
            <p className="text-xs text-text-muted mb-6">You can view the dashboard but cannot take any actions until your shift starts.</p>
            <button onClick={onLogout} className="w-full py-3 rounded-xl bg-sand-900 text-white font-bold text-sm">
              Log Out
            </button>
          </div>
        </div>
      )}

      {/* ═══ HEADER — mobile-first ═══ */}
      <header className="bg-white sticky top-0 z-20 border-b-2 border-sand-200 px-3 sm:px-4 py-2.5">
        <div className="max-w-[1600px] mx-auto">
          {/* Row 1: logo + name + primary utility cluster */}
          <div className="flex items-center gap-2 mb-2">
            {/* Logo */}
            <div className="w-8 h-8 rounded-lg bg-ocean-600 flex items-center justify-center flex-shrink-0">
              <span className="text-sm text-white font-semibold">W</span>
            </div>
            {/* Name + role + activity subtitle */}
            <div className="min-w-0 flex-1">
              <h1 className="text-sm sm:text-lg font-semibold text-text-primary flex items-center gap-1.5 truncate">
                <span className="truncate">{loggedInStaff.name}</span>
                <span className="text-[9px] sm:text-xs font-semibold px-1.5 sm:px-2 py-0.5 rounded-lg bg-sand-100 text-text-secondary flex-shrink-0">{loggedInStaff.role}</span>
                <span className={`w-2 h-2 rounded-full ${isOnShift ? "bg-status-good-500" : "bg-status-bad-500"} animate-pulse flex-shrink-0`} />
              </h1>
              <p className="text-[11px] sm:text-xs text-text-secondary font-semibold truncate">
                {activeOrders.length} active · {tables.filter((tb) => tb.status !== "empty").length} tables
              </p>
            </div>

            {/* Notifications always visible (waiter's lifeline) */}
            <NotificationBadge staffId={loggedInStaff.id} role="WAITER" />
            <ClockButton staffId={loggedInStaff.id} name={loggedInStaff.name} role={loggedInStaff.role} />
            {/* Always-visible language toggle: compact size so the
                mobile header doesn't overflow alongside the clock pill
                + notification badge + kebab. */}
            <LanguageToggle
              lang={lang}
              onToggle={toggleLang}
              className="h-8 px-2.5 rounded-xl text-[11px] font-bold bg-sand-100 text-text-secondary hover:bg-sand-200 transition active:scale-95"
            />

            {/* Desktop: inline history + schedule + logout */}
            <div className="hidden sm:flex items-center gap-1.5">
              <button onClick={() => setShowHistory(true)} className="p-2 hover:bg-sand-100 rounded-xl transition" title="Order history">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><polyline points="3 3 3 8 8 8"/><polyline points="12 7 12 12 15 14"/></svg>
              </button>
              <button onClick={() => setShowSchedule(true)} className="p-2 hover:bg-sand-100 rounded-xl transition" title="My Schedule">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </button>
              <button
                onClick={onLogout}
                className="inline-flex items-center gap-1.5 px-3 h-8 rounded-xl bg-sand-100 text-text-secondary hover:bg-status-bad-100 hover:text-status-bad-600 text-[11px] font-bold uppercase tracking-wider transition"
                title="Log out"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                Logout
              </button>
            </div>

            {/* Mobile kebab: schedule + logout. Language toggle moved
                out into the always-visible row above so it's reachable
                in one tap on every device. */}
            <WaiterHeaderMenu
              onOpenSchedule={() => setShowSchedule(true)}
              onLogout={onLogout}
            />
          </div>

          {/* Status badges — their own row so they never compete with the
              utility cluster. Horizontal scroll if too many on narrow phones. */}
          {(criticalCount > 0 || pendingCount > 0 || readyCount > 0 || delayedCount > 0) && (
            <div className="flex gap-1.5 mb-2 overflow-x-auto no-scrollbar">
              {criticalCount > 0 && (
                <span className="flex-shrink-0 px-2.5 py-1 rounded-xl bg-status-bad-100 text-status-bad-700 text-[11px] sm:text-xs font-semibold animate-pulse">
                  {criticalCount} CRITICAL
                </span>
              )}
              {pendingCount > 0 && (
                <span className="flex-shrink-0 px-2.5 py-1 rounded-xl bg-status-bad-50 text-status-bad-700 text-[11px] sm:text-xs font-bold">
                  {pendingCount} NEW
                </span>
              )}
              {readyCount > 0 && (
                <span className="flex-shrink-0 px-2.5 py-1 rounded-xl bg-status-good-100 text-status-good-700 text-[11px] sm:text-xs font-bold">
                  {readyCount} READY
                </span>
              )}
              {delayedCount > 0 && (
                <span className="flex-shrink-0 px-2.5 py-1 rounded-xl bg-status-warn-100 text-status-warn-700 text-[11px] sm:text-xs font-bold">
                  {delayedCount} DELAYED
                </span>
              )}
            </div>
          )}

          {/* Shift timer bar */}
          {loggedInStaff.shift !== 0 && (
            <div className={`flex items-center justify-between px-3 py-2 rounded-xl mt-2 ${
              isOnShift ? "bg-status-good-50 border border-status-good-200" : "bg-status-bad-50 border border-status-bad-200"
            }`}>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${isOnShift ? "bg-status-good-500" : "bg-status-bad-500"} animate-pulse`} />
                <span className={`text-xs font-bold ${isOnShift ? "text-status-good-700" : "text-status-bad-700"}`}>
                  {getShiftLabel(loggedInStaff.shift)}
                </span>
              </div>
              <span className={`text-sm font-semibold tabular-nums ${isOnShift ? "text-status-good-800" : "text-status-bad-800"}`}>
                {shiftInfo.label}
              </span>
            </div>
          )}

          {/* Waiter load bar */}
          <WaiterLoadBar
            activeOrders={myActiveOrderCount}
            maxOrders={waiterCapacity}
          />

          {/* Filter tabs */}
          <div className="flex gap-2 mt-3 overflow-x-auto no-scrollbar">
            {[
              { key: "all", tKey: "waiter.all", count: activeOrders.length },
              { key: "pending", tKey: "waiter.new", count: pendingCount },
              { key: "preparing", tKey: "waiter.cooking", count: preparingCount },
              { key: "ready", tKey: "waiter.ready", count: readyCount },
              { key: "served", tKey: "waiter.served", count: servedCount },
            ].map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap transition-all active:scale-95 ${
                  filter === f.key
                    ? "bg-sand-900 text-white"
                    : "bg-sand-100 text-text-secondary hover:bg-sand-200"
                }`}
              >
                {t(f.tKey)}
                {f.count > 0 && (
                  <span className={`ml-1.5 ${filter === f.key ? "opacity-70" : "opacity-50"}`}>
                    {f.count}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </header>
      {showSchedule && <SchedulePopup staffId={loggedInStaff.id} role={loggedInStaff.role} onClose={() => setShowSchedule(false)} />}
      {showHistory && <OrderHistoryDrawer orders={orders} role="waiter" onClose={() => setShowHistory(false)} />}

      {/* ═══ MAIN LAYOUT ═══ */}
      <main className="max-w-[1600px] mx-auto px-4 pt-4 pb-8">
        <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4">
          {/* LEFT SIDEBAR: Tables + Alerts */}
          <div className="space-y-3 lg:sticky lg:top-[200px] lg:self-start">
            <TableControlSystem
              tables={tables}
              orders={orders}
              onSelectTable={setSelectedTable}
              myTableNumbers={myTableNumbers}
            />

            {/* Alert Queue */}
            <AnimatePresence>
              <AlertBar
                alerts={visibleAlerts}
                onDismiss={(id) =>
                  setDismissedAlerts((s) => new Set([...s, id]))
                }
              />
            </AnimatePresence>

            {/* Sessions */}
            <SessionsPanel sessions={sessions} now={now} staffId={loggedInStaff.id} />

            {/* Owner Messages (voice notes, commands) */}
            <OwnerMessageBanner
              messages={visibleOwnerMessages}
              onDismiss={(id) => setDismissedMessages((s) => new Set([...s, id]))}
            />
          </div>

          {/* RIGHT: ORDER STREAM */}
          <div>
            {/* Validation Errors (System-level) */}
            {validationErrors.filter((e) => !e.orderId).length > 0 && (
              <div className="mb-3 space-y-1.5">
                {validationErrors
                  .filter((e) => !e.orderId)
                  .map((err, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-status-bad-50 border-2 border-status-bad-300 text-status-bad-800 text-sm font-bold"
                    >
                      <span>🚫</span>
                      <span>{err.message}</span>
                    </div>
                  ))}
              </div>
            )}

            {/* Order Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 auto-rows-min">
              <AnimatePresence mode="popLayout">
                {filtered.map(({ order, urgency }) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    urgency={urgency}
                    errors={validationErrors}
                    onAdvance={() => advanceOrder(order.id)}
                    onAddNote={(note) => addNoteToOrder(order.id, note)}
                    now={now}
                    isMyTable={(order.tableNumber != null && myTableNumbers.has(order.tableNumber)) || (order.sessionId != null && mySessionIds.has(order.sessionId))}
                  />
                ))}
              </AnimatePresence>

              {filtered.length === 0 && (
                <div className="col-span-full text-center py-16 bg-white rounded-2xl border-2 border-sand-200">
                  <p className="text-3xl mb-2">✓</p>
                  <p className="text-text-primary font-semibold text-lg">{t("waiter.allClear")}</p>
                  <p className="text-text-secondary text-sm mt-1">
                    {t("waiter.noOrders").replace("{filter}", filter === "all" ? t("waiter.active").toLowerCase() : t(`waiter.${filter === "pending" ? "new" : filter === "preparing" ? "cooking" : filter}`).toLowerCase())}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>

      {/* ═══ TABLE DETAIL MODAL ═══ */}
      <AnimatePresence>
        {selectedTable && (
          <TableDetailPanel
            table={selectedTable}
            orders={orders}
            onClose={() => setSelectedTable(null)}
            onUpdateTableStatus={handleUpdateTableStatus}
            onAdvanceOrder={advanceOrder}
            isMyTable={myTableNumbers.has(selectedTable.id)}
            waiterId={loggedInStaff.id}
            sessions={sessions}
            onTakeOrder={(tableNum, sessionId, guestCount) => {
              setSelectedTable(null);
              setWaiterOrderTarget({ tableNumber: tableNum, sessionId, guestCount });
            }}
          />
        )}
      </AnimatePresence>

      {/* ═══ WAITER ORDER PANEL ═══ */}
      <AnimatePresence>
        {waiterOrderTarget && (
          <WaiterOrderPanel
            tableNumber={waiterOrderTarget.tableNumber}
            sessionId={waiterOrderTarget.sessionId}
            guestCount={waiterOrderTarget.guestCount}
            onClose={() => setWaiterOrderTarget(null)}
            onOrderPlaced={() => {
              setWaiterOrderTarget(null);
            }}
          />
        )}
      </AnimatePresence>

    </div>
  );
}

// Mobile-only kebab dropdown for the waiter header. Holds the actions
// that don't need to be one-tap: schedule, language toggle, logout.
// Desktop inlines the same three as explicit buttons.
function WaiterHeaderMenu({
  onOpenSchedule,
  onLogout,
}: {
  onOpenSchedule: () => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onClick = () => setOpen(false);
    window.addEventListener("keydown", onKey);
    const ti = setTimeout(() => window.addEventListener("click", onClick), 0);
    return () => {
      clearTimeout(ti);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onClick);
    };
  }, [open]);

  return (
    <div className="sm:hidden relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-9 h-9 rounded-xl bg-sand-100 text-text-secondary flex items-center justify-center hover:bg-sand-200 transition"
        aria-label="More actions"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
      </button>
      {open && (
        <div className="absolute end-0 top-11 z-50 w-52 rounded-xl border border-sand-200 bg-white shadow-lg py-1">
          <button
            onClick={() => { setOpen(false); onOpenSchedule(); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-sand-50 transition"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-secondary"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span className="text-[12px] font-bold text-text-secondary">My Schedule</span>
          </button>
          <div className="border-t border-sand-100 mt-1 pt-1">
            <button
              onClick={() => { setOpen(false); onLogout(); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-status-bad-50 transition"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-status-bad-500">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span className="text-[12px] font-bold text-status-bad-600">Logout</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
