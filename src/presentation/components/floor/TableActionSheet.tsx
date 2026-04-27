"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLanguage } from "@/lib/use-language";
import { minsAgo, STATUS_COLORS } from "./constants";
import { OrderTimeline } from "./OrderTimeline";
import type { TableState, LiveOrder, SessionInfo, StaffInfo } from "./types";

export function TableActionSheet({
  table, orders, session, staff, allTables,
  onClose, onReassign, onSendWaiter, onPrioritize, onEndSession,
  onCancelItem, onChangeTable, onIncrementGuests, onAdvanceStatus,
}: {
  table: TableState;
  orders: LiveOrder[];
  session?: SessionInfo;
  staff: StaffInfo[];
  allTables: TableState[];
  onClose: () => void;
  onReassign: (sessionId: string, waiterId: string) => void;
  onSendWaiter: (tableId: number) => void;
  onPrioritize: (orderId: string) => void;
  onEndSession: (sessionId: string) => void;
  onCancelItem: (orderId: string, itemId: string, reason: string, action?: "cancel" | "comp") => void;
  onChangeTable: (sessionId: string, newTableNumber: number) => void;
  onIncrementGuests: (sessionId: string) => void;
  onAdvanceStatus: (orderId: string, status: string) => void;
}) {
  const [showReassign, setShowReassign] = useState(false);
  const [showMoveTable, setShowMoveTable] = useState(false);
  const [cancellingItem, setCancellingItem] = useState<{ orderId: string; itemId: string; mode: "cancel" | "comp" } | null>(null);
  const { t } = useLanguage();
  const tableOrders = orders.filter((o) => o.tableNumber === table.id && o.status !== "paid" && o.status !== "cancelled");
  const waiters = staff.filter((s) => s.role === "WAITER" && s.active);
  const emptyTables = allTables.filter((tb) => tb.status === "empty" && tb.id !== table.id);
  const elapsed = table.status !== "empty" ? minsAgo(table.sessionStart) : 0;
  const cancelReasons = [t("floor.cancelReasons.customerChanged"), t("floor.cancelReasons.outOfStock"), t("floor.cancelReasons.wrongItem"), t("floor.cancelReasons.tooLong"), t("floor.cancelReasons.managerDecision")];
  const compReasons = [t("floor.compReasons.apology"), t("floor.compReasons.vipGuest"), t("floor.compReasons.birthday"), t("floor.compReasons.managerDecision"), t("floor.compReasons.badExperience")];

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <motion.div
        className="relative w-full max-w-lg bg-white rounded-t-3xl max-h-[85vh] overflow-y-auto"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25 }}
      >
        <div className="sticky top-0 bg-white border-b border-sand-100 px-5 py-4 flex items-center justify-between z-10">
          <div>
            <h3 className="text-lg font-semibold text-text-primary">{t("common.table")} {table.id}</h3>
            <p className="text-xs text-text-secondary">
              {table.status === "empty" ? t("floor.empty") : `${table.guestCount} ${table.guestCount !== 1 ? t("common.guests") : t("common.guest")} \u00B7 ${elapsed} ${t("common.minutes")}`}
              {session?.waiterName && ` \u00B7 ${session.waiterName}`}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-sand-100 flex items-center justify-center text-text-secondary text-sm font-bold">&times;</button>
        </div>

        <div className="px-5 py-3 grid grid-cols-3 gap-2">
          <button onClick={() => { onSendWaiter(table.id); onClose(); }}
            className="p-3 rounded-xl bg-status-info-50 border border-status-info-200 text-status-info-700 text-xs font-bold active:scale-95 transition">
            {t("floor.sendWaiter")}
          </button>
          <button onClick={() => { setShowReassign(!showReassign); setShowMoveTable(false); }}
            className="p-3 rounded-xl bg-ocean-50 border border-ocean-200 text-ocean-700 text-xs font-bold active:scale-95 transition">
            {t("floor.reassign")}
          </button>
          {session && (
            <button onClick={() => { if (confirm(`${t("floor.endSession")} - ${t("common.table")} ${table.id}?`)) { onEndSession(session.id); onClose(); } }}
              className="p-3 rounded-xl bg-status-bad-50 border border-status-bad-200 text-status-bad-700 text-xs font-bold active:scale-95 transition">
              {t("floor.endSession")}
            </button>
          )}
        </div>

        {session && (
          <div className="px-5 pb-3 grid grid-cols-3 gap-2">
            {session.orderType !== "DELIVERY" && (
              <button onClick={() => { setShowMoveTable(!showMoveTable); setShowReassign(false); }}
                className="p-2.5 rounded-xl bg-status-wait-50 border border-status-wait-200 text-status-wait-700 text-xs font-bold active:scale-95 transition">
                {t("floor.moveTable")}
              </button>
            )}
            {session.orderType !== "DELIVERY" && (
              <button onClick={() => onIncrementGuests(session.id)}
                className="p-2.5 rounded-xl bg-status-good-50 border border-status-good-200 text-status-good-700 text-xs font-bold active:scale-95 transition">
                {t("floor.addGuest")}
              </button>
            )}
            <button onClick={() => onPrioritize(tableOrders[0]?.id || "")}
              disabled={tableOrders.length === 0}
              className="p-2.5 rounded-xl bg-status-warn-50 border border-status-warn-200 text-status-warn-700 text-xs font-bold active:scale-95 transition disabled:opacity-30">
              {t("floor.rushOrder")}
            </button>
          </div>
        )}

        <AnimatePresence>
          {showReassign && session && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="px-5 pb-3 overflow-hidden">
              <p className="text-[10px] font-bold text-text-secondary uppercase mb-2">{t("floor.assignTo")}</p>
              <div className="flex flex-wrap gap-2">
                {waiters.map((w) => (
                  <button key={w.id} onClick={() => { onReassign(session.id, w.id); setShowReassign(false); onClose(); }}
                    className={`px-3 py-2 rounded-lg border text-xs font-bold active:scale-95 transition ${
                      session.waiterId === w.id ? "bg-ocean-600 text-white border-ocean-600" : "bg-white border-sand-200 text-text-secondary"
                    }`}>{w.name}</button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showMoveTable && session && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="px-5 pb-3 overflow-hidden">
              <p className="text-[10px] font-bold text-text-secondary uppercase mb-2">{t("floor.moveToEmpty")}</p>
              {emptyTables.length === 0 ? (
                <p className="text-xs text-text-muted">{t("floor.noEmptyTables")}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {emptyTables.map((tb) => (
                    <button key={tb.id} onClick={() => { onChangeTable(session.id, tb.id); setShowMoveTable(false); onClose(); }}
                      className="w-12 h-12 rounded-xl bg-white border-2 border-sand-200 text-sm font-semibold text-text-secondary active:scale-95 transition hover:border-ocean-400">
                      {tb.id}
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {tableOrders.length > 0 && (
          <div className="px-5 pb-4">
            <p className="text-[10px] font-bold text-text-secondary uppercase mb-2">{t("floor.activeOrders")}</p>
            <div className="space-y-2">
              {tableOrders.map((order) => {
                const sc = STATUS_COLORS[order.status] || STATUS_COLORS.pending;
                const nextMap: Record<string, { label: string; status: string }> = {
                  pending: { label: t("floor.confirm"), status: "CONFIRMED" },
                  confirmed: { label: t("floor.startPrep"), status: "PREPARING" },
                  preparing: { label: t("floor.markReady"), status: "READY" },
                  ready: { label: t("floor.markServed"), status: "SERVED" },
                };
                const next = nextMap[order.status];
                return (
                  <div key={order.id} className="bg-sand-50 rounded-xl p-3 border border-sand-100">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-text-primary">#{order.orderNumber}</span>
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>
                          {{ pending: t("floor.statusPending"), confirmed: t("floor.statusConfirmed"), preparing: t("floor.preparing"), ready: t("floor.ready"), served: t("floor.served"), paid: t("floor.statusPaid"), cancelled: t("floor.statusCancelled") }[order.status] || order.status.toUpperCase()}
                        </span>
                        <span className="text-[10px] text-text-muted">{minsAgo(order.createdAt)}m</span>
                      </div>
                    </div>
                    <div className="space-y-1">
                      {order.items.map((item, idx) => {
                        const isPicking = cancellingItem?.orderId === order.id && cancellingItem?.itemId === item.id;
                        const reasons = isPicking && cancellingItem?.mode === "comp" ? compReasons : cancelReasons;
                        const reasonColor = isPicking && cancellingItem?.mode === "comp" ? "bg-status-good-100 text-status-good-700" : "bg-status-bad-100 text-status-bad-700";
                        return (
                        <div key={`${item.id}-${idx}`} className="flex items-center justify-between">
                          <span className={`text-xs ${item.cancelled ? "line-through text-text-muted" : item.comped ? "text-status-good-700" : "text-text-secondary"}`}>
                            {item.quantity > 1 && <span className="font-bold">{item.quantity}x </span>}
                            {item.name}
                            {item.comped && <span className="ml-1 text-[8px] font-semibold text-status-good-600">{t("floor.free")}</span>}
                          </span>
                          {!item.cancelled && !item.comped && isPicking ? (
                            <div className="flex gap-1 flex-wrap justify-end">
                              {reasons.map((r) => (
                                <button key={r} onClick={() => { onCancelItem(order.id, item.id, r, cancellingItem.mode); setCancellingItem(null); }}
                                  className={`px-1.5 py-0.5 rounded ${reasonColor} text-[8px] font-bold active:scale-95`}>{r}</button>
                              ))}
                              <button onClick={() => setCancellingItem(null)} className="px-1.5 py-0.5 rounded bg-sand-200 text-text-secondary text-[8px] font-bold">&times;</button>
                            </div>
                          ) : !item.cancelled && !item.comped ? (
                            <div className="flex items-center gap-1">
                              <button onClick={() => setCancellingItem({ orderId: order.id, itemId: item.id, mode: "comp" })} className="text-[9px] text-status-good-600 font-bold hover:text-status-good-800">{t("floor.free")}</button>
                              <button onClick={() => setCancellingItem({ orderId: order.id, itemId: item.id, mode: "cancel" })} className="text-[9px] text-status-bad-500 font-bold hover:text-status-bad-700">&times;</button>
                            </div>
                          ) : item.cancelled ? (
                            <span className="text-[9px] text-status-bad-400">{t("floor.void")}</span>
                          ) : (
                            <span className="text-[9px] text-status-good-500">{t("floor.comped")}</span>
                          )}
                        </div>
                        );
                      })}
                    </div>
                    <OrderTimeline order={order} />
                    <div className="flex gap-2 mt-2">
                      {next && (
                        <button onClick={() => onAdvanceStatus(order.id, next.status)}
                          className="flex-1 py-1.5 rounded-lg bg-ocean-600 text-white text-[10px] font-bold active:scale-95 transition">
                          {next.label}
                        </button>
                      )}
                      {(order.status === "pending" || order.status === "confirmed" || order.status === "preparing") && (
                        <button onClick={() => onPrioritize(order.id)}
                          className="flex-1 py-1.5 rounded-lg bg-status-warn-100 text-status-warn-700 text-[10px] font-bold active:scale-95 transition">
                          {t("floor.prioritize")}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="h-6" />
      </motion.div>
    </motion.div>
  );
}
