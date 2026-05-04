"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLanguage } from "@/lib/use-language";
import { minsAgo, STATUS_COLORS } from "./constants";
import { OrderTimeline } from "./OrderTimeline";
import type { TableState, LiveOrder, SessionInfo, StaffInfo } from "./types";

export function TableActionSheet({
  table, orders, session, sessions, staff, allTables,
  onClose, onReassign, onSendWaiter, onPrioritize, onEndSession,
  onCancelItem, onChangeTable, onMoveGuest, onMergeTables,
  onIncrementGuests, onAdvanceStatus,
}: {
  table: TableState;
  orders: LiveOrder[];
  session?: SessionInfo;
  sessions: SessionInfo[];
  staff: StaffInfo[];
  allTables: TableState[];
  onClose: () => void;
  onReassign: (sessionId: string, waiterId: string) => Promise<{ ok: boolean; message?: string }> | void;
  onSendWaiter: (tableId: number) => void;
  onPrioritize: (orderId: string) => void;
  onEndSession: (sessionId: string) => void;
  onCancelItem: (orderId: string, itemId: string, reason: string, action?: "cancel" | "comp") => void;
  onChangeTable: (sessionId: string, newTableNumber: number) => void;
  onMoveGuest: (
    sessionId: string,
    guest: { guestNumber: number | null; guestName: string | null },
    targetTableNumber: number,
  ) => Promise<{ ok: boolean; message?: string }>;
  onMergeTables: (
    sourceSessionId: string,
    targetSessionId: string,
  ) => Promise<{ ok: boolean; message?: string }>;
  onIncrementGuests: (sessionId: string) => void;
  onAdvanceStatus: (orderId: string, status: string) => void;
}) {
  const [showReassign, setShowReassign] = useState(false);
  const [reassignError, setReassignError] = useState<string | null>(null);
  const [reassignBusyId, setReassignBusyId] = useState<string | null>(null);
  const [showMoveTable, setShowMoveTable] = useState(false);
  // Move-guest is a two-step flow: pick a guest from this table, then
  // pick a target table. Selected guest is held here so the panel can
  // expand to the target picker without losing the choice.
  const [showMoveGuest, setShowMoveGuest] = useState(false);
  const [pickedGuest, setPickedGuest] = useState<{ guestNumber: number | null; guestName: string | null } | null>(null);
  const [moveGuestBusy, setMoveGuestBusy] = useState(false);
  const [moveGuestError, setMoveGuestError] = useState<string | null>(null);
  // Merge-tables: pick another OPEN table to merge INTO this one. Source
  // is the picked-up table (closed afterwards), target is THIS table.
  const [showMerge, setShowMerge] = useState(false);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  // "Full bill / browse" panel — read-only view of every order on this
  // session, grouped by guest, including paid items. Lets the floor
  // manager answer "what did Guest 3 actually order?" without scrolling
  // the cashier or guest UIs.
  const [showFullBill, setShowFullBill] = useState(false);
  const [cancellingItem, setCancellingItem] = useState<{ orderId: string; itemId: string; mode: "cancel" | "comp" } | null>(null);
  const { t } = useLanguage();
  const tableOrders = orders.filter((o) => o.tableNumber === table.id && o.status !== "paid" && o.status !== "cancelled");
  const waiters = staff.filter((s) => s.role === "WAITER" && s.active);
  const emptyTables = allTables.filter((tb) => tb.status === "empty" && tb.id !== table.id);
  // For move-guest target picker: any table OTHER than this one — empty
  // or already occupied. The server resolves whether to join an existing
  // session or create a fresh one at the destination. Excludes the
  // current table to avoid "move to where I already am".
  const moveGuestTargets = allTables.filter((tb) => tb.id !== table.id);
  // For merge target picker: ALL other open table sessions. We exclude
  // this session itself and DELIVERY/VIP sessions (the use-case rejects
  // them server-side; filtering here keeps the picker clean).
  const otherOpenSessions = sessions.filter(
    (s) =>
      s.status === "OPEN" &&
      s.id !== session?.id &&
      s.tableNumber != null &&
      s.orderType !== "DELIVERY" &&
      s.orderType !== "VIP_DINE_IN",
  );

  // Every order on this session (including paid + cancelled). Used by
  // the full-bill / browse panel so the floor manager sees the table's
  // complete history at a glance, not just what's still active.
  const allSessionOrders = orders.filter((o) => o.sessionId === session?.id);

  // Distinct guests on this table — keyed by guestNumber when present,
  // falling back to a name-only entry. Considers ALL the session's
  // orders the floor view knows about, paid included. A guest who
  // already paid for round 1 and is sitting at the table waiting on
  // round 2 still appears here; so does one whose entire bill is paid.
  const guestList: { key: string; guestNumber: number | null; guestName: string | null; label: string }[] = (() => {
    const seen = new Map<string, { guestNumber: number | null; guestName: string | null; label: string }>();
    for (const o of allSessionOrders) {
      const num = o.guestNumber ?? null;
      const name = o.guestName?.trim() || null;
      // Only include rows that have at least a guestNumber. Truly
      // anonymous orders (guestNumber == null AND no name) bunch into
      // a single fallback "shared" entry that isn't movable individually.
      if (num == null && !name) continue;
      const key = num != null ? `n:${num}` : `s:${name}`;
      if (seen.has(key)) continue;
      const label = name ? name : `Guest ${num}`;
      seen.set(key, { guestNumber: num, guestName: name, label });
    }
    return Array.from(seen.entries()).map(([key, v]) => ({ key, ...v }));
  })();

  // For the full-bill panel: orders grouped by their guest identity
  // (number → name fallback → "Shared / no guest"). Each group carries
  // the orders themselves so the panel can render every line + status.
  const ordersByGuest: { key: string; label: string; orders: typeof allSessionOrders; subtotal: number }[] = (() => {
    const groups = new Map<string, { label: string; orders: typeof allSessionOrders }>();
    const sharedKey = "_shared";
    for (const o of allSessionOrders) {
      const num = o.guestNumber ?? null;
      const name = o.guestName?.trim() || null;
      const key = num != null ? `n:${num}` : name ? `s:${name}` : sharedKey;
      const label = num != null
        ? (name ? `${name} (Guest ${num})` : `Guest ${num}`)
        : name
          ? name
          : t("floor.sharedOrders");
      if (!groups.has(key)) groups.set(key, { label, orders: [] });
      groups.get(key)!.orders.push(o);
    }
    return Array.from(groups.entries()).map(([key, v]) => {
      const subtotal = v.orders.reduce((s, o) => {
        if (o.status === "cancelled") return s;
        return s + (o.total || 0);
      }, 0);
      return { key, label: v.label, orders: v.orders, subtotal };
    });
  })();
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
              <button onClick={() => { setShowMoveTable(!showMoveTable); setShowReassign(false); setShowMoveGuest(false); setShowMerge(false); }}
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

        {/* Floor-only actions: move a single guest with their items,
            merge with another table, or browse the full bill grouped
            by guest. Hidden for DELIVERY sessions where neither
            concept applies. */}
        {session && session.orderType !== "DELIVERY" && (
          <div className="px-5 pb-3 grid grid-cols-3 gap-2">
            <button
              onClick={() => {
                setShowMoveGuest(!showMoveGuest);
                setShowReassign(false); setShowMoveTable(false); setShowMerge(false); setShowFullBill(false);
                setPickedGuest(null); setMoveGuestError(null);
              }}
              disabled={guestList.length === 0}
              className="p-2.5 rounded-xl bg-ocean-50 border border-ocean-200 text-ocean-700 text-xs font-bold active:scale-95 transition disabled:opacity-30">
              {t("floor.moveGuest")}
            </button>
            <button
              onClick={() => {
                setShowMerge(!showMerge);
                setShowReassign(false); setShowMoveTable(false); setShowMoveGuest(false); setShowFullBill(false);
                setMergeError(null);
              }}
              disabled={otherOpenSessions.length === 0}
              className="p-2.5 rounded-xl bg-sunset-50 border border-sunset-200 text-sunset-700 text-xs font-bold active:scale-95 transition disabled:opacity-30">
              {t("floor.mergeTables")}
            </button>
            <button
              onClick={() => {
                setShowFullBill(!showFullBill);
                setShowReassign(false); setShowMoveTable(false); setShowMoveGuest(false); setShowMerge(false);
              }}
              disabled={allSessionOrders.length === 0}
              className="p-2.5 rounded-xl bg-sand-100 border border-sand-300 text-text-primary text-xs font-bold active:scale-95 transition disabled:opacity-30">
              {t("floor.fullBill")}
            </button>
          </div>
        )}

        <AnimatePresence>
          {showReassign && session && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="px-5 pb-3 overflow-hidden">
              <p className="text-[10px] font-bold text-text-secondary uppercase mb-2">{t("floor.assignTo")}</p>
              <div className="flex flex-wrap gap-2">
                {waiters.map((w) => (
                  <button key={w.id} disabled={reassignBusyId !== null}
                    onClick={async () => {
                      setReassignError(null);
                      setReassignBusyId(w.id);
                      const result = await onReassign(session.id, w.id);
                      setReassignBusyId(null);
                      if (result && result.ok === false) {
                        setReassignError(result.message || "Assign failed");
                        return;
                      }
                      setShowReassign(false);
                      onClose();
                    }}
                    className={`px-3 py-2 rounded-lg border text-xs font-bold active:scale-95 transition disabled:opacity-50 ${
                      session.waiterId === w.id ? "bg-ocean-600 text-white border-ocean-600" : "bg-white border-sand-200 text-text-secondary"
                    }`}>{w.name}{reassignBusyId === w.id ? " …" : ""}</button>
                ))}
              </div>
              {reassignError && (
                <div className="mt-2 px-3 py-2 rounded-lg bg-status-bad-50 border border-status-bad-200 text-status-bad-700 text-xs font-semibold">
                  {reassignError}
                </div>
              )}
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

        {/* Move-guest panel: pick a guest first, then a target table.
            Two-step picker so a tap-and-undo doesn't fire a move with a
            half-formed selection. The target list includes occupied
            tables — server resolves whether to join or create. */}
        <AnimatePresence>
          {showMoveGuest && session && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="px-5 pb-3 overflow-hidden">
              {!pickedGuest ? (
                <>
                  <p className="text-[10px] font-bold text-text-secondary uppercase mb-2">{t("floor.pickGuestToMove")}</p>
                  {guestList.length === 0 ? (
                    <p className="text-xs text-text-muted">{t("floor.noNamedGuests")}</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {guestList.map((g) => (
                        <button key={g.key}
                          onClick={() => { setPickedGuest({ guestNumber: g.guestNumber, guestName: g.guestName }); setMoveGuestError(null); }}
                          className="px-3 py-2 rounded-lg bg-white border-2 border-sand-200 text-xs font-bold text-text-secondary active:scale-95 transition hover:border-ocean-400">
                          {g.label}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-bold text-text-secondary uppercase">
                      {t("floor.moveGuestTo")} <span className="text-ocean-600">{pickedGuest.guestName || `Guest ${pickedGuest.guestNumber}`}</span>
                    </p>
                    <button onClick={() => { setPickedGuest(null); setMoveGuestError(null); }}
                      className="text-[10px] font-bold text-text-muted underline">
                      {t("common.cancel")}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {moveGuestTargets.map((tb) => {
                      const isOccupied = tb.status !== "empty";
                      return (
                        <button key={tb.id}
                          disabled={moveGuestBusy}
                          onClick={async () => {
                            if (!session) return;
                            setMoveGuestBusy(true);
                            setMoveGuestError(null);
                            const r = await onMoveGuest(session.id, pickedGuest, tb.id);
                            setMoveGuestBusy(false);
                            if (!r.ok) {
                              setMoveGuestError(r.message || "Move failed");
                              return;
                            }
                            setShowMoveGuest(false);
                            setPickedGuest(null);
                            onClose();
                          }}
                          className={`w-12 h-12 rounded-xl border-2 text-sm font-semibold active:scale-95 transition disabled:opacity-50 ${
                            isOccupied
                              ? "bg-ocean-50 border-ocean-200 text-ocean-700 hover:border-ocean-500"
                              : "bg-white border-sand-200 text-text-secondary hover:border-ocean-400"
                          }`}
                          title={isOccupied ? t("floor.tableOccupied") : t("floor.tableEmpty")}
                        >
                          {tb.id}
                        </button>
                      );
                    })}
                  </div>
                  {moveGuestError && (
                    <div className="mt-2 px-3 py-2 rounded-lg bg-status-bad-50 border border-status-bad-200 text-status-bad-700 text-xs font-semibold">
                      {moveGuestError}
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Merge-tables panel: list every other open table session and
            let the manager pick the one that's joining INTO this table.
            That picked table closes; this one absorbs all its orders +
            guests with collision-safe re-numbering server-side. */}
        <AnimatePresence>
          {showMerge && session && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="px-5 pb-3 overflow-hidden">
              <p className="text-[10px] font-bold text-text-secondary uppercase mb-2">
                {t("floor.mergeFromTable")} <span className="text-text-primary">→ T{table.id}</span>
              </p>
              {otherOpenSessions.length === 0 ? (
                <p className="text-xs text-text-muted">{t("floor.noOtherOpenTables")}</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {otherOpenSessions.map((s) => (
                    <button key={s.id}
                      disabled={mergeBusy}
                      onClick={async () => {
                        if (!session) return;
                        if (!confirm(`${t("floor.confirmMerge")}: T${s.tableNumber} → T${table.id}?`)) return;
                        setMergeBusy(true);
                        setMergeError(null);
                        const r = await onMergeTables(s.id, session.id);
                        setMergeBusy(false);
                        if (!r.ok) {
                          setMergeError(r.message || "Merge failed");
                          return;
                        }
                        setShowMerge(false);
                        onClose();
                      }}
                      className="px-3 py-2 rounded-lg bg-white border-2 border-sand-200 text-xs font-bold text-text-secondary active:scale-95 transition hover:border-sunset-400 disabled:opacity-50">
                      T{s.tableNumber} <span className="text-text-muted">({s.guestCount})</span>
                    </button>
                  ))}
                </div>
              )}
              {mergeError && (
                <div className="mt-2 px-3 py-2 rounded-lg bg-status-bad-50 border border-status-bad-200 text-status-bad-700 text-xs font-semibold">
                  {mergeError}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Full-bill / browse panel: every guest + every order they've
            placed on this session, paid or unpaid. Read-only — there's
            no action here, just a comprehensive picture so the floor
            manager can answer "what did Guest 3 actually order?" or
            "how much has table 7 spent so far?" without bouncing to
            the cashier or the guest's phone. */}
        <AnimatePresence>
          {showFullBill && session && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="px-5 pb-3 overflow-hidden">
              {ordersByGuest.length === 0 ? (
                <p className="text-xs text-text-muted">{t("floor.noOrdersYet")}</p>
              ) : (
                <div className="space-y-3">
                  {ordersByGuest.map((g) => (
                    <div key={g.key} className="rounded-xl bg-sand-50 border border-sand-200 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-bold text-text-primary">{g.label}</p>
                        <p className="text-xs font-bold text-text-secondary tabular-nums">
                          {Math.round(g.subtotal)} {t("common.egp")}
                        </p>
                      </div>
                      <div className="space-y-1.5">
                        {g.orders.map((o) => {
                          const sc = STATUS_COLORS[o.status] || STATUS_COLORS.pending;
                          return (
                            <div key={o.id} className="bg-white rounded-lg border border-sand-100 px-2.5 py-2">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] font-bold text-text-muted">#{o.orderNumber}</span>
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>
                                  {(({ pending: t("floor.statusPending"), confirmed: t("floor.statusConfirmed"), preparing: t("floor.preparing"), ready: t("floor.ready"), served: t("floor.served"), paid: t("floor.statusPaid"), cancelled: t("floor.statusCancelled") }) as Record<string, string>)[o.status] || o.status.toUpperCase()}
                                </span>
                              </div>
                              <ul className="space-y-0.5">
                                {o.items.map((it, idx) => (
                                  <li
                                    key={`${it.id}-${idx}`}
                                    className={`text-[11px] flex items-center justify-between gap-2 ${
                                      it.cancelled
                                        ? "line-through text-text-muted"
                                        : it.comped
                                          ? "text-status-good-700"
                                          : "text-text-secondary"
                                    }`}
                                  >
                                    <span>
                                      {it.quantity > 1 && <span className="font-bold">{it.quantity}× </span>}
                                      {it.name}
                                      {it.comped && <span className="ms-1 text-[8px] font-semibold text-status-good-600">{t("floor.free")}</span>}
                                    </span>
                                    <span className="tabular-nums text-text-muted">
                                      {Math.round(it.price * it.quantity)}
                                    </span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          );
                        })}
                      </div>
                    </div>
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
