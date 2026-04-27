"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLanguage } from "@/lib/use-language";
import { getOrderTag } from "@/lib/order-label";
import { minsAgo, STATUS_COLORS } from "./constants";
import { OrderTimeline } from "./OrderTimeline";
import type { LiveOrder, SessionInfo, StaffInfo } from "./types";

export function OrderActionSheet({
  order, sessions, staff,
  onClose, onAdvanceStatus, onPrioritize, onCancelItem, onReassign,
  onAssignDriver, onUpdateDeliveryStatus,
}: {
  order: LiveOrder;
  sessions: SessionInfo[];
  staff: StaffInfo[];
  onClose: () => void;
  onAdvanceStatus: (orderId: string, status: string) => void;
  onPrioritize: (orderId: string) => void;
  onCancelItem: (orderId: string, itemId: string, reason: string, action?: "cancel" | "comp") => void;
  onReassign: (sessionId: string, waiterId: string) => void;
  onAssignDriver: (orderId: string, driverId: string) => void;
  onUpdateDeliveryStatus: (orderId: string, status: string) => void;
}) {
  const [showReassign, setShowReassign] = useState(false);
  const [showDriverPicker, setShowDriverPicker] = useState(false);
  const [cancellingItem, setCancellingItem] = useState<{ id: string; mode: "cancel" | "comp" } | null>(null);
  const { t } = useLanguage();
  const compReasons = [t("floor.compReasons.apology"), t("floor.compReasons.vipGuest"), t("floor.compReasons.birthday"), t("floor.compReasons.managerDecision"), t("floor.compReasons.badExperience")];
  const session = sessions.find((s) =>
    (order.tableNumber != null && s.tableNumber === order.tableNumber && s.status === "OPEN") ||
    (order.sessionId && s.id === order.sessionId)
  );
  const waiters = staff.filter((s) => s.role === "WAITER" && s.active);
  const drivers = staff.filter((s) => s.role === "DELIVERY" && s.active);
  const sc = STATUS_COLORS[order.status] || STATUS_COLORS.pending;
  const nextStatusMap: Record<string, { label: string; status: string }> = {
    pending: { label: t("floor.confirm"), status: "CONFIRMED" },
    confirmed: { label: t("floor.startPrep"), status: "PREPARING" },
    preparing: { label: t("floor.markReady"), status: "READY" },
    ready: { label: t("floor.markServed"), status: "SERVED" },
  };
  const next = nextStatusMap[order.status];
  const isDelivery = order.orderType === "DELIVERY";
  const cancelReasons = [t("floor.cancelReasons.customerChanged"), t("floor.cancelReasons.outOfStock"), t("floor.cancelReasons.wrongItem"), t("floor.cancelReasons.tooLong"), t("floor.cancelReasons.managerDecision")];

  return (
    <motion.div className="fixed inset-0 z-50 flex items-end justify-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <motion.div
        className="relative w-full max-w-lg bg-white rounded-t-3xl max-h-[85vh] overflow-y-auto"
        initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 25 }}
      >
        <div className="sticky top-0 bg-white border-b border-sand-100 px-5 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center text-xs font-semibold text-white ${
              isDelivery ? "bg-status-warn-500" : order.orderType === "VIP_DINE_IN" ? "bg-status-wait-600" : "bg-ocean-600"
            }`}>
              {getOrderTag(order)}
            </div>
            <div>
              <h3 className="text-lg font-semibold text-text-primary">{t("common.order")} #{order.orderNumber}</h3>
              <div className="flex items-center gap-2">
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>{{ pending: t("floor.statusPending"), confirmed: t("floor.statusConfirmed"), preparing: t("floor.preparing"), ready: t("floor.ready"), served: t("floor.served"), paid: t("floor.statusPaid"), cancelled: t("floor.statusCancelled") }[order.status] || order.status.toUpperCase()}</span>
                <span className="text-[10px] text-text-muted">{minsAgo(order.createdAt)}{t("common.minutes")}</span>
                <span className="text-[10px] font-bold text-status-good-600">{order.total} EGP</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-sand-100 flex items-center justify-center text-text-secondary text-sm font-bold">&times;</button>
        </div>

        <div className="px-5 py-3">
          <p className="text-[10px] font-bold text-text-secondary uppercase mb-2">{t("floor.items")}</p>
          <div className="space-y-1">
            {order.items.map((item, idx) => {
              const isPicking = cancellingItem?.id === item.id;
              const reasons = isPicking && cancellingItem?.mode === "comp" ? compReasons : cancelReasons;
              const reasonColor = isPicking && cancellingItem?.mode === "comp" ? "bg-status-good-100 text-status-good-700" : "bg-status-bad-100 text-status-bad-700";
              return (
              <div key={`${item.id}-${idx}`} className="flex items-center justify-between py-1">
                <span className={`text-xs ${item.cancelled ? "line-through text-text-muted" : item.comped ? "text-status-good-700" : "text-text-secondary"}`}>
                  {item.quantity > 1 && <span className="font-bold">{item.quantity}x </span>}{item.name}
                  {item.comped && <span className="ml-1 text-[8px] font-semibold text-status-good-600">{t("floor.free")}</span>}
                </span>
                {!item.cancelled && !item.comped && isPicking ? (
                  <div className="flex gap-1 flex-wrap justify-end">
                    {reasons.map((r) => (
                      <button key={r} onClick={() => { onCancelItem(order.id, item.id, r, cancellingItem.mode); setCancellingItem(null); }}
                        className={`px-1.5 py-0.5 rounded ${reasonColor} text-[8px] font-bold`}>{r}</button>
                    ))}
                    <button onClick={() => setCancellingItem(null)} className="px-1.5 py-0.5 rounded bg-sand-200 text-text-secondary text-[8px] font-bold">&times;</button>
                  </div>
                ) : !item.cancelled && !item.comped ? (
                  <div className="flex items-center gap-1">
                    <button onClick={() => setCancellingItem({ id: item.id, mode: "comp" })} className="text-[9px] text-status-good-600 font-bold">{t("floor.free")}</button>
                    <button onClick={() => setCancellingItem({ id: item.id, mode: "cancel" })} className="text-[9px] text-status-bad-500 font-bold">&times;</button>
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
        </div>

        <div className="px-5 pb-3">
          <OrderTimeline order={order} />
        </div>

        <div className="px-5 pb-3 space-y-2">
          {next && (
            <button onClick={() => { onAdvanceStatus(order.id, next.status); onClose(); }}
              className="w-full py-3 rounded-xl bg-ocean-600 text-white text-sm font-bold active:scale-[0.98] transition">
              {next.label}
            </button>
          )}

          <div className="grid grid-cols-2 gap-2">
            {["pending", "confirmed", "preparing"].includes(order.status) && (
              <button onClick={() => { onPrioritize(order.id); onClose(); }}
                className="py-2.5 rounded-xl bg-status-warn-50 border border-status-warn-200 text-status-warn-700 text-xs font-bold active:scale-95 transition">
                {t("floor.prioritize")}
              </button>
            )}
            {session && (
              <button onClick={() => { setShowReassign(!showReassign); setShowDriverPicker(false); }}
                className="py-2.5 rounded-xl bg-ocean-50 border border-ocean-200 text-ocean-700 text-xs font-bold active:scale-95 transition">
                {t("floor.reassignWaiter")}
              </button>
            )}
            {isDelivery && !order.deliveryStatus && (
              <button onClick={() => { setShowDriverPicker(!showDriverPicker); setShowReassign(false); }}
                className="py-2.5 rounded-xl bg-status-good-50 border border-status-good-200 text-status-good-700 text-xs font-bold active:scale-95 transition">
                {t("floor.assignDriver")}
              </button>
            )}
            {isDelivery && order.deliveryStatus === "ASSIGNED" && (
              <button onClick={() => { onUpdateDeliveryStatus(order.id, "PICKED_UP"); onClose(); }}
                className="py-2.5 rounded-xl bg-status-info-50 border border-status-info-200 text-status-info-700 text-xs font-bold active:scale-95 transition">
                {t("floor.markPickedUp")}
              </button>
            )}
            {isDelivery && order.deliveryStatus === "PICKED_UP" && (
              <button onClick={() => { onUpdateDeliveryStatus(order.id, "ON_THE_WAY"); onClose(); }}
                className="py-2.5 rounded-xl bg-status-info-50 border border-status-info-200 text-status-info-700 text-xs font-bold active:scale-95 transition">
                {t("floor.markOnTheWay")}
              </button>
            )}
            {isDelivery && order.deliveryStatus === "ON_THE_WAY" && (
              <button onClick={() => { onUpdateDeliveryStatus(order.id, "DELIVERED"); onClose(); }}
                className="py-2.5 rounded-xl bg-status-good-50 border border-status-good-200 text-status-good-700 text-xs font-bold active:scale-95 transition">
                {t("floor.markDelivered")}
              </button>
            )}
          </div>
        </div>

        <AnimatePresence>
          {showReassign && session && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="px-5 pb-3 overflow-hidden">
              <p className="text-[10px] font-bold text-text-secondary uppercase mb-2">{t("floor.assignToWaiter")}</p>
              <div className="flex flex-wrap gap-2">
                {waiters.map((w) => (
                  <button key={w.id} onClick={() => { onReassign(session.id, w.id); onClose(); }}
                    className={`px-3 py-2 rounded-lg border text-xs font-bold active:scale-95 transition ${
                      session.waiterId === w.id ? "bg-ocean-600 text-white border-ocean-600" : "bg-white border-sand-200 text-text-secondary"
                    }`}>{w.name}</button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showDriverPicker && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="px-5 pb-3 overflow-hidden">
              <p className="text-[10px] font-bold text-text-secondary uppercase mb-2">{t("floor.assignDriverLabel")}</p>
              {drivers.length === 0 ? (
                <p className="text-xs text-text-muted">{t("floor.noDrivers")}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {drivers.map((d) => (
                    <button key={d.id} onClick={() => { onAssignDriver(order.id, d.id); onClose(); }}
                      className="px-3 py-2 rounded-lg border border-sand-200 bg-white text-xs font-bold text-text-secondary active:scale-95 transition">{d.name}</button>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="h-6" />
      </motion.div>
    </motion.div>
  );
}
