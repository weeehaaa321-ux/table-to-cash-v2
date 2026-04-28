"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useLanguage } from "@/lib/use-language";
import type { LiveOrder } from "@/lib/engine/perception";

// Closed-out states. Anything in this set is "history" — already done,
// no further action expected from the staff member viewing.
const HISTORY_STATES = new Set(["served", "paid", "cancelled"]);

type Role = "kitchen" | "bar" | "waiter" | "floor";

type DateRange = "today" | "yesterday" | "week";

function startOfDayMs(daysAgo: number): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.getTime();
}

function rangeToBounds(range: DateRange): { from: number; to: number } {
  const now = Date.now();
  if (range === "today") return { from: startOfDayMs(0), to: now };
  if (range === "yesterday") return { from: startOfDayMs(1), to: startOfDayMs(0) };
  return { from: startOfDayMs(7), to: now };
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getOrderTag(o: LiveOrder): string {
  if (o.orderType === "VIP_DINE_IN" && o.vipGuestName) return o.vipGuestName;
  if (o.orderType === "DELIVERY") return o.vipGuestName ? `${o.vipGuestName} (delivery)` : "Delivery";
  return o.tableNumber != null ? `T-${o.tableNumber}` : "—";
}

const STATUS_CHIP: Record<string, { bg: string; text: string; label: string }> = {
  served: { bg: "bg-status-good-100", text: "text-status-good-800", label: "Served" },
  paid: { bg: "bg-sand-200", text: "text-text-secondary", label: "Paid" },
  cancelled: { bg: "bg-status-bad-100", text: "text-status-bad-800", label: "Cancelled" },
};

export function OrderHistoryDrawer({
  orders,
  role,
  onClose,
}: {
  orders: LiveOrder[];
  role: Role;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const [range, setRange] = useState<DateRange>("today");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  // Filter to history-state orders only, in the chosen window, matching search.
  const historyOrders = useMemo(() => {
    const { from, to } = rangeToBounds(range);
    const q = search.trim().toLowerCase();
    return orders
      .filter((o) => HISTORY_STATES.has(o.status))
      .filter((o) => {
        const t = o.servedAt ?? o.createdAt;
        return t >= from && t <= to;
      })
      .filter((o) => {
        if (!q) return true;
        if (String(o.orderNumber).includes(q)) return true;
        if (o.tableNumber != null && `t-${o.tableNumber}`.includes(q)) return true;
        if (o.vipGuestName?.toLowerCase().includes(q)) return true;
        if (o.items.some((i) => i.name?.toLowerCase().includes(q))) return true;
        return false;
      })
      .sort((a, b) => {
        const ta = a.servedAt ?? a.createdAt;
        const tb = b.servedAt ?? b.createdAt;
        return tb - ta;
      });
  }, [orders, range, search]);

  // Role-specific summary metrics shown at the top of the list.
  const summary = useMemo(() => {
    const totalRevenue = historyOrders
      .filter((o) => o.status !== "cancelled")
      .reduce((s, o) => s + (Number(o.total) || 0), 0);
    const cancelled = historyOrders.filter((o) => o.status === "cancelled").length;
    return {
      count: historyOrders.length,
      revenue: Math.round(totalRevenue),
      cancelled,
    };
  }, [historyOrders]);

  const titleByRole: Record<Role, string> = {
    kitchen: "Kitchen history",
    bar: "Bar history",
    waiter: "Order history",
    floor: "All orders today",
  };

  return (
    <>
      <motion.div
        key="history-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/40 z-40"
      />
      <motion.aside
        key="history-drawer"
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 280 }}
        className="fixed top-0 right-0 bottom-0 w-full max-w-md bg-bg-base z-50 shadow-2xl flex flex-col"
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-4 border-b border-sand-200">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-text-muted mb-1">
                History
              </div>
              <h2 className="text-2xl font-extrabold text-text-primary leading-tight">
                {titleByRole[role]}
              </h2>
            </div>
            <button
              onClick={onClose}
              className="w-11 h-11 rounded-full bg-sand-100 hover:bg-sand-200 flex items-center justify-center text-text-secondary transition active:scale-95"
              aria-label="Close history"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="6" y1="6" x2="18" y2="18" />
                <line x1="6" y1="18" x2="18" y2="6" />
              </svg>
            </button>
          </div>

          {/* Date range tabs */}
          <div className="flex gap-1.5 mb-3">
            {(["today", "yesterday", "week"] as DateRange[]).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`flex-1 py-2 rounded-lg text-xs font-bold transition active:scale-[0.98] ${
                  range === r
                    ? "bg-text-primary text-white"
                    : "bg-sand-100 text-text-secondary hover:bg-sand-200"
                }`}
              >
                {r === "today" ? "Today" : r === "yesterday" ? "Yesterday" : "Last 7 days"}
              </button>
            ))}
          </div>

          {/* Search */}
          <input
            type="search"
            inputMode="search"
            placeholder="Search by #, table, item, or VIP name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3.5 py-2.5 rounded-lg border border-sand-200 bg-white text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-status-info-400 focus:ring-2 focus:ring-status-info-100"
          />
        </div>

        {/* Summary row */}
        <div className="px-5 py-3 bg-sand-50 border-b border-sand-200 flex items-center justify-between">
          <div className="flex gap-5">
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-widest text-text-muted">
                Orders
              </div>
              <div className="text-lg font-extrabold tabular-nums text-text-primary leading-none mt-0.5">
                {summary.count}
              </div>
            </div>
            {role !== "kitchen" && role !== "bar" && (
              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-widest text-text-muted">
                  Revenue
                </div>
                <div className="text-lg font-extrabold tabular-nums text-text-primary leading-none mt-0.5">
                  {summary.revenue.toLocaleString()}
                </div>
              </div>
            )}
            {summary.cancelled > 0 && (
              <div>
                <div className="text-[10px] font-extrabold uppercase tracking-widest text-status-bad-600">
                  Cancelled
                </div>
                <div className="text-lg font-extrabold tabular-nums text-status-bad-600 leading-none mt-0.5">
                  {summary.cancelled}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
          {historyOrders.length === 0 ? (
            <div className="py-16 text-center">
              <div className="text-4xl mb-3 opacity-50">📋</div>
              <div className="text-sm text-text-muted">No orders match these filters.</div>
            </div>
          ) : (
            historyOrders.map((o) => {
              const chip = STATUS_CHIP[o.status] || { bg: "bg-sand-200", text: "text-text-secondary", label: o.status };
              const ts = o.servedAt ?? o.createdAt;
              const isOpen = expanded === o.id;
              return (
                <motion.div
                  key={o.id}
                  layout
                  className="bg-white border border-sand-200 rounded-xl overflow-hidden"
                >
                  <button
                    onClick={() => setExpanded(isOpen ? null : o.id)}
                    className="w-full px-4 py-3 flex items-center gap-3 hover:bg-sand-50 transition text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 mb-0.5">
                        <span className="text-base font-extrabold tabular-nums text-text-primary">
                          #{o.orderNumber}
                        </span>
                        <span className="text-sm font-bold text-text-secondary truncate">
                          {getOrderTag(o)}
                        </span>
                        <span className={`flex-shrink-0 text-[9px] font-extrabold uppercase tracking-widest px-1.5 py-0.5 rounded ${chip.bg} ${chip.text}`}>
                          {chip.label}
                        </span>
                      </div>
                      <div className="text-xs text-text-muted">
                        {fmtTime(ts)} · {o.items.length} item{o.items.length === 1 ? "" : "s"}
                        {o.paymentMethod && o.status !== "cancelled" && (
                          <> · <span className="font-semibold uppercase">{o.paymentMethod}</span></>
                        )}
                      </div>
                    </div>
                    {role !== "kitchen" && role !== "bar" && o.status !== "cancelled" && (
                      <div className="text-right flex-shrink-0">
                        <div className="text-base font-extrabold tabular-nums text-text-primary">
                          {Math.round(Number(o.total) || 0).toLocaleString()}
                        </div>
                      </div>
                    )}
                    <svg
                      className={`w-4 h-4 text-text-muted transition-transform flex-shrink-0 ${isOpen ? "rotate-180" : ""}`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>

                  {isOpen && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      className="border-t border-sand-200 bg-sand-50/50 px-4 py-3"
                    >
                      <div className="space-y-1.5">
                        {o.items.map((item, idx) => (
                          <div key={`${item.id}-${idx}`} className={`flex items-baseline gap-3 text-sm ${item.cancelled ? "opacity-50 line-through" : ""}`}>
                            <span className="font-extrabold tabular-nums text-text-primary min-w-[2rem]">
                              ×{item.quantity}
                            </span>
                            <span className="flex-1 font-medium text-text-primary">
                              {item.name}
                              {item.comped && <span className="ml-2 text-[10px] font-extrabold uppercase tracking-widest text-status-good-700">comped</span>}
                              {item.cancelled && <span className="ml-2 text-[10px] font-extrabold uppercase tracking-widest text-status-bad-600">void</span>}
                            </span>
                            {!item.cancelled && !item.comped && (
                              <span className="text-text-muted tabular-nums text-xs">
                                {Math.round(Number(item.price) || 0).toLocaleString()}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Cancellation / comp reasons */}
                      {o.items.some((i) => i.cancelReason || i.compReason) && (
                        <div className="mt-3 pt-3 border-t border-sand-200 space-y-1">
                          {o.items
                            .filter((i) => i.cancelReason || i.compReason)
                            .map((i, idx) => (
                              <div key={idx} className="text-[11px] text-text-muted">
                                <span className="font-semibold">{i.name}:</span>{" "}
                                <span className="italic">{i.cancelReason || i.compReason}</span>
                              </div>
                            ))}
                        </div>
                      )}

                      {o.notes && (
                        <div className="mt-3 pt-3 border-t border-sand-200 text-xs text-text-muted">
                          <span className="font-extrabold uppercase tracking-widest">Notes: </span>
                          <span>{o.notes}</span>
                        </div>
                      )}

                      <div className="mt-3 pt-3 border-t border-sand-200 grid grid-cols-2 gap-2 text-[11px] text-text-muted">
                        <div>
                          <div className="font-extrabold uppercase tracking-widest text-text-muted/70">Created</div>
                          <div>{fmtTime(o.createdAt)}</div>
                        </div>
                        {o.servedAt && (
                          <div>
                            <div className="font-extrabold uppercase tracking-widest text-text-muted/70">Served</div>
                            <div>{fmtTime(o.servedAt)}</div>
                          </div>
                        )}
                        <div>
                          <div className="font-extrabold uppercase tracking-widest text-text-muted/70">Total</div>
                          <div className="font-bold tabular-nums">{Math.round(Number(o.total) || 0).toLocaleString()}</div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              );
            })
          )}
        </div>
      </motion.aside>
    </>
  );
}
