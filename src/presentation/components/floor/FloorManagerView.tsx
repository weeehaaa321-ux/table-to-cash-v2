"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ClockButton } from "@/presentation/components/ui/ClockButton";
import LogoutButton from "@/presentation/components/ui/LogoutButton";
import SchedulePopup from "@/presentation/components/ui/SchedulePopup";
import { OrderHistoryDrawer } from "@/presentation/components/ui/OrderHistoryDrawer";
import { LanguageToggle } from "@/presentation/components/ui/LanguageToggle";
import { getOrderTag } from "@/lib/order-label";
import { useLanguage } from "@/lib/use-language";
import { initials, minsAgo, STATUS_COLORS, TABLE_ACCENT, TABLE_COLORS, WAITER_PALETTE, ALERT_ICONS } from "./constants";
import { useFloorData } from "./useFloorData";
import { TableActionSheet } from "./TableActionSheet";
import { OrderActionSheet } from "./OrderActionSheet";
import { DeliveryCard } from "./DeliveryCard";
import { IssueLogForm } from "./IssueLogForm";
import { MenuControlPanel } from "./MenuControlPanel";
import { JoinGatePanel } from "./JoinGatePanel";
import type { LoggedInStaff, TableState, LiveOrder, SessionInfo, WaiterMetric, StaffInfo, DeliveryOrder, RecentMessage } from "./types";
import type { FloorAlert } from "@/lib/floor-alerts";

// ═══════════════════════════════════════════════════════════════════
// FLOOR MANAGER — COMMAND BRIDGE
//
// Single-screen, three-column layout. No tabs. Desktop/tablet-first.
// Collapses to a single stacked column below the `lg` breakpoint.
//
//   ┌──────────────────────────────────────────────────────────┐
//   │ HEADER (slim)                                             │
//   ├──────────┬───────────────────────────────┬────────────────┤
//   │ ATTENTION│  FLOOR MAP (hero)             │ STAFF LIVE     │
//   │ QUEUE    │                               │ KITCHEN        │
//   │          │  HIGH-VALUE SPOTLIGHT         │ BAR            │
//   │          │  VIP SESSIONS                 │ DELIVERY       │
//   ├──────────┴───────────────────────────────┴────────────────┤
//   │ QUICK COMMS BAR (slim)                                    │
//   └───────────────────────────────────────────────────────────┘
//
// All polling, mutations, and derivations live in `useFloorData`. This
// component is pure rendering + UI state (selected table, selected
// order, drawer visibility, floor view mode, keyboard focus).
// ═══════════════════════════════════════════════════════════════════

type FloorMode = "status" | "age" | "revenue" | "waiter";

export function FloorManagerView({ staff }: { staff: LoggedInStaff }) {
  const { t } = useLanguage();
  const d = useFloorData(staff);

  // ─── UI state (not data) ─────────────────────────────
  const [selectedTable, setSelectedTable] = useState<TableState | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<LiveOrder | null>(null);
  const [floorMode, setFloorMode] = useState<FloorMode>("status");
  const [showSchedule, setShowSchedule] = useState(false);
  const [showSnapshot, setShowSnapshot] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showOrderHistory, setShowOrderHistory] = useState(false);
  const [showIssueForm, setShowIssueForm] = useState(false);
  const commsInputRef = useRef<HTMLInputElement | null>(null);

  // ─── Keyboard shortcuts ──────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Esc: close the topmost overlay.
      if (e.key === "Escape") {
        if (selectedOrder) { setSelectedOrder(null); return; }
        if (selectedTable) { setSelectedTable(null); return; }
        if (showIssueForm) { setShowIssueForm(false); return; }
        if (showHistory) { setShowHistory(false); return; }
        if (showSnapshot) { setShowSnapshot(false); return; }
        if (showSchedule) { setShowSchedule(false); return; }
      }
      // "/" focuses the comms input — classic pro-tool shortcut.
      if (e.key === "/" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        commsInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [selectedOrder, selectedTable, showIssueForm, showHistory, showSnapshot, showSchedule]);

  return (
    <div className="h-dvh flex flex-col bg-sand-50 text-text-primary">
      <HeaderBar
        staff={staff}
        shiftLabel={d.shiftInfo.label}
        shiftProgressPct={d.shiftProgressPct}
        criticalCount={d.criticalCount}
        warningCount={d.warningCount}
        actionHistoryCount={d.actionHistory.length}
        onOpenIssue={() => setShowIssueForm(true)}
        onOpenHistory={() => setShowHistory(true)}
        onOpenOrderHistory={() => setShowOrderHistory(true)}
        onOpenSnapshot={() => setShowSnapshot(true)}
        onOpenSchedule={() => setShowSchedule(true)}
      />

      {/* Mobile section jump nav — sticky horizontal pill bar, desktop hides it */}
      <MobileJumpNav />

      {/* MAIN — mobile: natural scroll, one column; desktop: 3-column grid */}
      <div className="flex-1 overflow-y-auto lg:overflow-hidden lg:grid lg:grid-cols-[320px_minmax(0,1fr)_360px] lg:gap-3 lg:p-3 space-y-3 p-3 lg:space-y-0">
        {/* MOBILE — pulse stripe up top for instant situational read */}
        <section id="jump-pulse" className="lg:hidden">
          <PulseStripe
            occupancy={d.metrics.occupancy}
            occupied={d.occupied}
            total={d.tables.length}
            guests={d.totalGuests}
            pendingBillCount={d.tables.filter((tb) => tb.status === "waiting_bill" || tb.status === "paying").length}
            unpaidTotal={d.openSessions.reduce((acc, s) => acc + (s.unpaidTotal || 0), 0)}
            unassignedDeliveries={d.unassignedDeliveries.length}
            revenueToday={d.metrics.revenueToday}
            revenuePerHour={d.revenuePerHour}
          />
        </section>

        {/* LEFT — ATTENTION */}
        <aside id="jump-alerts" className="lg:min-h-0 lg:overflow-y-auto lg:no-scrollbar space-y-3">
          {/* Stuck-at-gate guests waiting on an absent session owner.
              Hidden when the queue is empty so the column stays
              clean during the normal-case flow. */}
          <JoinGatePanel
            requests={d.pendingJoinRequests}
            onAdmit={d.handleAdmitJoinRequest}
            onReject={d.handleRejectJoinRequest}
          />
          <AttentionQueue
            alerts={d.alerts}
            urgentOrders={d.urgentOrders}
            vipSessions={d.vipSessions}
            sessions={d.sessions}
            tables={d.tables}
            now={d.now}
            onAlertAction={(a) => {
              // Dispatch by alert type — every severity has a concrete action
              // from this button, no silent no-ops.
              // 1. Table-scoped alerts → open the table action sheet.
              if (a.tableNumber != null) {
                const tb = d.tables.find((t) => t.id === a.tableNumber);
                if (tb) { setSelectedTable(tb); return; }
              }
              // 2. Delivery alerts → open the oldest unresolved delivery order.
              if (a.type === "delivery_unassigned" || a.type === "delivery_late") {
                const matchId = a.orderId;
                const target = (matchId && d.orders.find((o) => o.id === matchId))
                  || d.orders.find((o) => o.orderType === "DELIVERY" && o.status !== "paid" && o.status !== "cancelled")
                  || null;
                if (target) { setSelectedOrder(target); return; }
              }
              // 3. Kitchen bottleneck → prioritize the named order (old behavior).
              if (a.type === "kitchen_bottleneck" && a.orderId) {
                d.handlePrioritize(a.orderId);
                return;
              }
              // 4. Waiter overloaded → open their heaviest table so the mgr can
              //    reassign it from the table sheet.
              if (a.type === "waiter_overloaded" && a.waiterId) {
                const heaviest = d.openSessions
                  .filter((s) => s.waiterId === a.waiterId && s.tableNumber != null)
                  .sort((x, y) => (y.unpaidTotal || 0) - (x.unpaidTotal || 0))[0];
                if (heaviest) {
                  const tb = d.tables.find((t) => t.id === heaviest.tableNumber);
                  if (tb) { setSelectedTable(tb); return; }
                }
              }
              // 5. Fallback — still route to the hook in case more types get added.
              d.handleAlertAction(a);
            }}
            onDismissAlert={d.handleDismissAlert}
            onSelectOrder={(o) => setSelectedOrder(o)}
            onSelectTable={(tb) => setSelectedTable(tb)}
          />
        </aside>

        {/* CENTER — FLOOR */}
        <main id="jump-floor" className="lg:min-h-0 lg:overflow-y-auto lg:no-scrollbar space-y-3">
          {/* Desktop keeps pulse stripe inside the center column */}
          <div className="hidden lg:block">
            <PulseStripe
              occupancy={d.metrics.occupancy}
              occupied={d.occupied}
              total={d.tables.length}
              guests={d.totalGuests}
              pendingBillCount={d.tables.filter((tb) => tb.status === "waiting_bill" || tb.status === "paying").length}
              unpaidTotal={d.openSessions.reduce((acc, s) => acc + (s.unpaidTotal || 0), 0)}
              unassignedDeliveries={d.unassignedDeliveries.length}
              revenueToday={d.metrics.revenueToday}
              revenuePerHour={d.revenuePerHour}
            />
          </div>
          <FloorMap
            tables={d.tables}
            sessions={d.sessions}
            orders={d.orders}
            alerts={d.alerts}
            allStaff={d.allStaff}
            mode={floorMode}
            onChangeMode={setFloorMode}
            now={d.now}
            onSelect={(tb) => setSelectedTable(tb)}
          />
          <HighValueSpotlight
            highValue={d.highValueTables}
            tables={d.tables}
            now={d.now}
            onSelect={(tb) => setSelectedTable(tb)}
          />
          <VipSection
            vipSessions={d.vipSessions}
            now={d.now}
            onSelect={(s) => {
              const tb = d.tables.find((t) => t.id === s.tableNumber);
              if (tb) setSelectedTable(tb);
            }}
          />
        </main>

        {/* RIGHT — LIVE OPS */}
        <aside className="lg:min-h-0 lg:overflow-y-auto lg:no-scrollbar space-y-3">
          <section id="jump-staff">
          <StaffLivePanel
            waiterMetrics={d.waiterMetrics}
            staffPresence={d.staffPresence}
            loadSummary={d.loadSummary}
            unassignedSessions={d.openSessions.filter((s) => s.status === "OPEN" && !s.waiterId && s.tableNumber != null)}
            onReassign={d.handleReassign}
            onMessage={(staffId) => {
              d.setCommsTarget(staffId);
              commsInputRef.current?.focus();
              commsInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
            }}
            onSelectWaiterTable={(s) => {
              const tb = d.tables.find((t) => t.id === s.tableNumber);
              if (tb) setSelectedTable(tb);
            }}
          />
          </section>
          <section id="jump-kitchen">
          <StationPanel
            label={t("floor.kitchen")}
            capacity={d.kitchen.capacity}
            activeCount={d.kitchen.activeOrders}
            avgPrep={d.kitchen.avgPrepTime}
            stuckCount={d.kitchen.stuckOrders.length}
            oldest={d.orders.filter((o) => o.status === "preparing").sort((a, b) => a.createdAt - b.createdAt)[0] || null}
            now={d.now}
            onPrioritizeOldest={(o) => d.handlePrioritize(o.id)}
            onOpenOrder={(o) => setSelectedOrder(o)}
          />
          </section>
          {(d.bar.activeOrders > 0 || d.bar.capacity > 0) && (
            <StationPanel
              label={t("floor.bar")}
              capacity={d.bar.capacity}
              activeCount={d.bar.activeOrders}
              avgPrep={d.bar.avgPrepTime}
              stuckCount={d.bar.stuckOrders.length}
              oldest={null}
              now={d.now}
            />
          )}
          <section id="jump-delivery">
          <DeliveryLivePanel
            deliveries={d.deliveries}
            unassignedCount={d.unassignedDeliveries.length}
            drivers={d.allStaff.filter((s) => s.role === "DELIVERY" && s.active)}
            onAssign={d.handleAssignDriver}
            onUpdateStatus={d.handleUpdateDeliveryStatus}
          />
          </section>
          <section id="jump-pay">
          <PaymentQueuePanel
            sessions={d.openSessions}
            tables={d.tables}
            onSelect={(tb) => setSelectedTable(tb)}
          />
          </section>
          <section id="jump-menu">
          <MenuControlPanel />
          </section>
        </aside>
      </div>

      {/* QUICK COMMS — slim footer */}
      <QuickCommsBar
        ref={commsInputRef}
        text={d.commsText}
        setText={d.setCommsText}
        target={d.commsTarget}
        setTarget={d.setCommsTarget}
        staff={d.allStaff}
        recentMessages={d.recentMessages}
        onSend={d.handleBroadcast}
      />

      {/* OVERLAYS */}
      {showSchedule && (
        <SchedulePopup staffId={staff.id} role={staff.role} onClose={() => setShowSchedule(false)} />
      )}

      <AnimatePresence>
        {selectedTable && (
          <TableActionSheet
            key="table-sheet"
            table={selectedTable}
            orders={d.orders}
            session={d.sessions.find((s) => s.tableNumber === selectedTable.id && s.status === "OPEN")}
            sessions={d.sessions}
            staff={d.allStaff}
            allTables={d.tables}
            waiterAppEnabled={d.waiterAppEnabled}
            onClose={() => setSelectedTable(null)}
            onReassign={d.handleReassign}
            onSendWaiter={d.handleSendWaiter}
            onPrioritize={d.handlePrioritize}
            onEndSession={d.handleEndSession}
            onCancelItem={d.handleCancelItem}
            onChangeTable={d.handleChangeTable}
            onMoveGuest={d.handleMoveGuest}
            onMergeTables={d.handleMergeTables}
            onIncrementGuests={d.handleIncrementGuests}
            onAdvanceStatus={d.handleAdvanceStatus}
          />
        )}
        {selectedOrder && (
          <OrderActionSheet
            key="order-sheet"
            order={selectedOrder}
            sessions={d.sessions}
            staff={d.allStaff}
            onClose={() => setSelectedOrder(null)}
            onAdvanceStatus={d.handleAdvanceStatus}
            onPrioritize={d.handlePrioritize}
            onCancelItem={d.handleCancelItem}
            onReassign={d.handleReassign}
            onAssignDriver={d.handleAssignDriver}
            onUpdateDeliveryStatus={d.handleUpdateDeliveryStatus}
          />
        )}
        {showIssueForm && (
          <IssueLogForm
            key="issue-form"
            tables={d.tables}
            onClose={() => setShowIssueForm(false)}
            onSubmit={async (cat, tableId, desc) => {
              await d.handleLogIssue(cat, tableId, desc);
              setShowIssueForm(false);
            }}
          />
        )}
        {showSnapshot && (
          <ShiftSnapshotDrawer
            key="snapshot"
            staff={staff}
            occupied={d.occupied}
            totalTables={d.tables.length}
            guests={d.totalGuests}
            revenueToday={d.metrics.revenueToday}
            revenuePerHour={d.revenuePerHour}
            openSessions={d.openSessions}
            deliveries={d.deliveries}
            orders={d.orders}
            actionHistory={d.actionHistory}
            onClose={() => setShowSnapshot(false)}
          />
        )}
        {showHistory && (
          <ActionHistoryDrawer
            key="history"
            actionHistory={d.actionHistory}
            onClose={() => setShowHistory(false)}
          />
        )}
        {showOrderHistory && (
          <OrderHistoryDrawer
            key="order-history"
            orders={d.orders}
            role="floor"
            onClose={() => setShowOrderHistory(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// HEADER
// ═══════════════════════════════════════════════════════════════════

function HeaderBar({
  staff, shiftLabel, shiftProgressPct, criticalCount, warningCount,
  actionHistoryCount, onOpenIssue, onOpenHistory, onOpenOrderHistory, onOpenSnapshot, onOpenSchedule,
}: {
  staff: LoggedInStaff;
  shiftLabel: string;
  shiftProgressPct: number;
  criticalCount: number;
  warningCount: number;
  actionHistoryCount: number;
  onOpenIssue: () => void;
  onOpenHistory: () => void;
  onOpenOrderHistory: () => void;
  onOpenSnapshot: () => void;
  onOpenSchedule: () => void;
}) {
  const { t, lang, toggleLang } = useLanguage();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the overflow menu on Esc or outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuOpen(false); };
    const onClick = () => setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    // Defer so the click that opened the menu doesn't immediately close it.
    const t = setTimeout(() => window.addEventListener("click", onClick), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onClick);
    };
  }, [menuOpen]);

  return (
    <header className="h-12 flex-shrink-0 border-b border-sand-200 bg-white flex items-center gap-2 px-3">
      {/* Logo + name — name hides below sm to save horizontal room */}
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-7 h-7 rounded-lg bg-ocean-600 flex items-center justify-center flex-shrink-0">
          <span className="text-xs text-white font-semibold">F</span>
        </div>
        <div className="leading-tight hidden sm:block min-w-0">
          <p className="text-xs font-semibold text-text-primary truncate">{staff.name}</p>
          <p className="text-[9px] text-text-muted truncate">{shiftLabel}</p>
        </div>
      </div>

      {/* Shift progress — desktop only */}
      {staff.shift !== 0 && (
        <div className="hidden md:flex items-center gap-2 flex-1 max-w-sm">
          <div className="flex-1 h-1 rounded-full bg-sand-200 overflow-hidden">
            <div className="h-full bg-ocean-500 transition-all duration-1000" style={{ width: `${shiftProgressPct}%` }} />
          </div>
          <span className="text-[10px] font-semibold tabular-nums text-text-secondary">{shiftProgressPct}%</span>
        </div>
      )}

      <div className="ml-auto flex items-center gap-1 min-w-0">
        {/* Alert chips — number only below sm, number + label from sm+ */}
        {criticalCount > 0 && (
          <span className="px-1.5 sm:px-2 h-6 rounded-full bg-status-bad-600 text-white text-[10px] font-semibold tabular-nums inline-flex items-center">
            <span className="sm:hidden">{criticalCount}</span>
            <span className="hidden sm:inline">{criticalCount} {t("floor.critical")}</span>
          </span>
        )}
        {warningCount > 0 && (
          <span className="px-1.5 sm:px-2 h-6 rounded-full bg-status-warn-500 text-white text-[10px] font-semibold tabular-nums inline-flex items-center">
            <span className="sm:hidden">{warningCount}</span>
            <span className="hidden sm:inline">{warningCount} {t("floor.warn")}</span>
          </span>
        )}

        <ClockButton staffId={staff.id} name={staff.name} role={staff.role} />

        {/* Issue — always visible, the only icon on the primary bar on mobile */}
        <HeaderIconButton title={t("floor.logIssueTitle")} onClick={onOpenIssue} tone="rose">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </HeaderIconButton>

        {/* Desktop shows all icons inline + language toggle. Mobile collapses History /
            Snapshot / Schedule / Language / Logout into a kebab dropdown. */}
        <div className="hidden md:flex items-center gap-1">
          <HeaderIconButton title={t("floor.actionHistory")} onClick={onOpenHistory} badge={actionHistoryCount}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.74 9.74 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>
          </HeaderIconButton>
          <HeaderIconButton title="Order history" onClick={onOpenOrderHistory}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
          </HeaderIconButton>
          <HeaderIconButton title={t("floor.shiftSnapshot")} onClick={onOpenSnapshot}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
          </HeaderIconButton>
          <HeaderIconButton title={t("floor.mySchedule")} onClick={onOpenSchedule}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          </HeaderIconButton>
          <LanguageToggle lang={lang} onToggle={toggleLang} className="h-7 px-2 rounded-lg text-[11px] font-semibold bg-sand-100 text-text-secondary hover:bg-sand-200 transition" />
          <LogoutButton role="floormanager" />
        </div>

        {/* Mobile kebab */}
        <div className="md:hidden relative" onClick={(e) => e.stopPropagation()}>
          <HeaderIconButton title={t("floor.more")} onClick={() => setMenuOpen((v) => !v)} badge={actionHistoryCount}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
          </HeaderIconButton>
          {menuOpen && (
            <div className="absolute end-0 top-10 z-50 w-56 rounded-xl border border-sand-200 bg-white shadow-lg py-1">
              <MenuRow label={t("floor.actionHistory")} badge={actionHistoryCount} onClick={() => { setMenuOpen(false); onOpenHistory(); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.74 9.74 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>
              </MenuRow>
              <MenuRow label="Order history" onClick={() => { setMenuOpen(false); onOpenOrderHistory(); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
              </MenuRow>
              <MenuRow label={t("floor.shiftSnapshot")} onClick={() => { setMenuOpen(false); onOpenSnapshot(); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>
              </MenuRow>
              <MenuRow label={t("floor.mySchedule")} onClick={() => { setMenuOpen(false); onOpenSchedule(); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </MenuRow>
              <MenuRow label={lang === "ar" ? "English" : "العربية"} onClick={() => { toggleLang(); setMenuOpen(false); }}>
                <span className="w-3.5 h-3.5 inline-flex items-center justify-center text-[9px] font-semibold text-text-secondary bg-sand-100 rounded">ع</span>
              </MenuRow>
              <div className="px-2 py-1 border-t border-sand-100 mt-1">
                <LogoutButton role="floormanager" />
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function MenuRow({ children, label, badge, onClick }: {
  children: React.ReactNode;
  label: string;
  badge?: number;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-sand-50 transition">
      <span className="w-5 h-5 flex items-center justify-center text-text-secondary">{children}</span>
      <span className="text-[12px] font-bold text-text-secondary flex-1">{label}</span>
      {badge != null && badge > 0 && (
        <span className="px-1.5 py-0.5 rounded-full bg-ocean-100 text-ocean-700 text-[9px] font-semibold tabular-nums">{badge > 99 ? "99" : badge}</span>
      )}
    </button>
  );
}

function HeaderIconButton({ children, title, onClick, tone = "slate", badge }: {
  children: React.ReactNode; title: string; onClick: () => void; tone?: "slate" | "rose"; badge?: number;
}) {
  const cls = tone === "rose" ? "text-status-bad-600 hover:bg-status-bad-50" : "text-text-secondary hover:bg-sand-100";
  return (
    <button onClick={onClick} title={title} className={`relative w-8 h-8 rounded-lg flex items-center justify-center transition ${cls}`}>
      {children}
      {badge != null && badge > 0 && (
        <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-ocean-500 text-white text-[8px] font-semibold flex items-center justify-center tabular-nums">
          {badge > 99 ? "99" : badge}
        </span>
      )}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MOBILE JUMP NAV
// Sticky horizontal pill bar that scrolls the mobile user to any
// section without thumb-scrolling through the whole stack.
// Hidden on lg+ where everything's already visible in one frame.
// ═══════════════════════════════════════════════════════════════════

function MobileJumpNav() {
  const { t } = useLanguage();
  const items = [
    { id: "jump-pulse", label: t("floor.jump.pulse") },
    { id: "jump-alerts", label: t("floor.jump.alerts") },
    { id: "jump-floor", label: t("floor.jump.floor") },
    { id: "jump-staff", label: t("floor.jump.staff") },
    { id: "jump-kitchen", label: t("floor.jump.kitchen") },
    { id: "jump-delivery", label: t("floor.jump.delivery") },
    { id: "jump-pay", label: t("floor.jump.pay") },
    { id: "jump-menu", label: t("floor.jump.menu") },
  ];
  const jumpTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <nav className="lg:hidden sticky top-0 z-30 bg-sand-50/95 backdrop-blur-sm border-b border-sand-200">
      <div className="flex gap-1 overflow-x-auto no-scrollbar px-3 py-2">
        {items.map((item) => (
          <button
            key={item.id}
            onClick={() => jumpTo(item.id)}
            className="flex-shrink-0 px-3 h-9 rounded-full bg-white border border-sand-200 text-[11px] font-semibold uppercase tracking-wider text-text-secondary active:bg-ocean-50 active:text-ocean-700 active:border-ocean-200 transition"
          >
            {item.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CENTER — PULSE STRIPE (4 gauges above the floor map)
// ═══════════════════════════════════════════════════════════════════

function PulseStripe({
  occupancy, occupied, total, guests, pendingBillCount, unpaidTotal,
  unassignedDeliveries, revenueToday, revenuePerHour,
}: {
  occupancy: number;
  occupied: number;
  total: number;
  guests: number;
  pendingBillCount: number;
  unpaidTotal: number;
  unassignedDeliveries: number;
  revenueToday: number;
  revenuePerHour: number;
}) {
  const { t } = useLanguage();
  // Kitchen and bar live on the right column with full detail — keeping
  // them here too was duplicating numbers. The stripe now focuses on
  // things the floor manager can only see at the floor level: how full
  // the room is, what's waiting to pay, delivery handoff, and revenue
  // pace. Each tile still earns its spot.
  const cards: { label: string; value: string; sub: string; pct: number; tone: "signal" | "neutral"; raw: number }[] = [
    { label: t("floor.occupancy"), value: `${occupancy}%`, sub: `${occupied}/${total} · ${guests}g`, pct: occupancy, tone: "signal", raw: occupancy },
    { label: t("floor.billQueue"), value: `${pendingBillCount}`, sub: unpaidTotal > 0 ? `${Math.round(unpaidTotal).toLocaleString()} ${t("common.egp")}` : t("floor.allPaid"), pct: Math.min(100, pendingBillCount * 25), tone: "signal", raw: pendingBillCount * 25 },
    { label: t("floor.deliveryQueue"), value: `${unassignedDeliveries}`, sub: unassignedDeliveries === 0 ? t("floor.allAssigned") : t("floor.awaitingDriver"), pct: Math.min(100, unassignedDeliveries * 33), tone: "signal", raw: unassignedDeliveries * 33 },
    { label: t("floor.paceHr"), value: revenuePerHour.toLocaleString(), sub: `${Math.round(revenueToday).toLocaleString()} ${t("common.egp")} today`, pct: 100, tone: "neutral", raw: 0 },
  ];
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
      {cards.map((g) => {
        const color = g.tone === "neutral"
          ? "bg-ocean-500"
          : g.raw > 85 ? "bg-status-bad-500" : g.raw > 60 ? "bg-status-warn-500" : "bg-status-good-500";
        const textTone = g.tone === "neutral"
          ? "text-text-secondary"
          : g.raw > 85 ? "text-status-bad-600" : g.raw > 60 ? "text-status-warn-600" : "text-status-good-600";
        return (
          <div key={g.label} className="rounded-xl bg-white border border-sand-200 px-3 py-2">
            <div className="flex items-baseline justify-between">
              <span className="text-[9px] font-semibold uppercase tracking-widest text-text-muted">{g.label}</span>
              <span className={`text-sm font-semibold tabular-nums ${textTone}`}>{g.value}</span>
            </div>
            <div className="mt-1 h-1 rounded-full bg-sand-100 overflow-hidden">
              <div className={`h-full rounded-full ${color} transition-all duration-500`} style={{ width: `${Math.min(100, g.pct)}%` }} />
            </div>
            <p className="text-[9px] text-text-muted mt-0.5 tabular-nums truncate">{g.sub}</p>
          </div>
        );
      })}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// LEFT — ATTENTION QUEUE
// ═══════════════════════════════════════════════════════════════════

function AttentionQueue({
  alerts, urgentOrders, vipSessions, sessions, tables, now,
  onAlertAction, onDismissAlert, onSelectOrder, onSelectTable,
}: {
  alerts: FloorAlert[];
  urgentOrders: LiveOrder[];
  vipSessions: SessionInfo[];
  sessions: SessionInfo[];
  tables: TableState[];
  now: number;
  onAlertAction: (a: FloorAlert) => void;
  onDismissAlert: (id: string) => void;
  onSelectOrder: (o: LiveOrder) => void;
  onSelectTable: (tb: TableState) => void;
}) {
  const { t } = useLanguage();
  const isEmpty = alerts.length === 0 && urgentOrders.length === 0;
  const totalCount = alerts.length + urgentOrders.length;

  return (
    <div className="rounded-2xl bg-white border border-sand-200 h-full flex flex-col" aria-live="polite">
      <div className="px-4 py-3 border-b border-sand-100 flex items-center justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">{t("floor.attention")}</p>
          <p className="text-sm font-semibold text-text-primary tabular-nums">{totalCount} {totalCount === 1 ? t("floor.item") : t("floor.items")}</p>
        </div>
        {totalCount > 0 && (
          <span className="text-[10px] text-text-muted font-bold">{t("floor.oldestFirst")}</span>
        )}
      </div>

      {isEmpty ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
          <div className="w-14 h-14 rounded-full bg-status-good-50 text-status-good-600 flex items-center justify-center text-xl mb-3">✓</div>
          <p className="text-sm font-semibold text-status-good-700">{t("floor.nothingNeeds")}</p>
          <p className="text-[11px] text-text-muted mt-1">{t("floor.serviceFlowing")}</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto no-scrollbar divide-y divide-sand-100">
          <AnimatePresence initial={false}>
            {alerts.map((alert) => (
              <AttentionAlertCard
                key={alert.id}
                alert={alert}
                now={now}
                onAction={onAlertAction}
                onDismiss={onDismissAlert}
              />
            ))}
          </AnimatePresence>
          {urgentOrders.map((order) => (
            <AttentionOrderCard
              key={order.id}
              order={order}
              session={sessions.find((s) => (order.tableNumber != null && s.tableNumber === order.tableNumber && s.status === "OPEN") || (order.sessionId && s.id === order.sessionId))}
              now={now}
              onClick={() => onSelectOrder(order)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AttentionAlertCard({ alert, now, onAction, onDismiss }: {
  alert: FloorAlert;
  now: number;
  onAction: (a: FloorAlert) => void;
  onDismiss: (id: string) => void;
}) {
  const { t } = useLanguage();
  // Pulse dropped: severity is already encoded in the badge color +
  // the card's position in the priority queue. A constant heartbeat
  // becomes visual noise within a minute of sitting on the floor.
  const toneMap = alert.severity === "critical"
    ? { badge: "bg-status-bad-500", text: "text-status-bad-700", bg: "bg-status-bad-50", pulse: "" }
    : alert.severity === "warning"
      ? { badge: "bg-status-warn-500", text: "text-status-warn-700", bg: "bg-status-warn-50", pulse: "" }
      : { badge: "bg-status-info-500", text: "text-status-info-700", bg: "bg-status-info-50", pulse: "" };
  const age = Math.max(0, Math.round((now - alert.since) / 60000));

  return (
    <motion.div layout
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 8 }}
      className="px-4 py-3"
    >
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2 h-2 rounded-full ${toneMap.badge} ${toneMap.pulse}`} />
        <span className="text-[10px] font-extrabold tabular-nums uppercase tracking-widest text-text-muted">{age}{t("common.minutes")}</span>
        <span className={`ml-auto text-[10px] font-extrabold uppercase tracking-widest ${toneMap.text}`}>{alert.severity}</span>
      </div>
      <div className="flex items-start gap-2.5">
        <div className={`flex-shrink-0 w-11 h-11 rounded-lg ${toneMap.badge} ${toneMap.pulse} text-white flex items-center justify-center text-sm font-extrabold`}>
          {alert.tableNumber || ALERT_ICONS[alert.type] || "!"}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-extrabold text-text-primary leading-tight">{alert.message}</p>
          <p className="text-[11px] text-text-secondary mt-1 leading-snug">{alert.suggestedAction}</p>
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-2.5">
        <button onClick={() => onAction(alert)}
          className={`flex-1 h-9 rounded-lg text-[11px] font-extrabold uppercase tracking-wider text-white ${toneMap.badge} active:scale-95 transition`}>
          {t("floor.fix")}
        </button>
        <button onClick={() => onDismiss(alert.id)}
          className="w-9 h-9 rounded-lg text-text-muted hover:bg-sand-100 text-base font-bold">×</button>
      </div>
    </motion.div>
  );
}

function AttentionOrderCard({ order, session, now, onClick }: {
  order: LiveOrder;
  session?: SessionInfo;
  now: number;
  onClick: () => void;
}) {
  const { t } = useLanguage();
  const waitMin = Math.max(0, Math.round((now - order.createdAt) / 60000));
  const isStuck = order.status === "preparing" && waitMin > 15;
  const isReady = order.status === "ready";
  const toneMap = isStuck
    ? { badge: "bg-status-bad-500", text: "text-status-bad-700" }
    : isReady
      ? { badge: "bg-status-good-500", text: "text-status-good-700" }
      : { badge: "bg-status-warn-500", text: "text-status-warn-700" };

  return (
    <button onClick={onClick}
      className="w-full text-left px-4 py-3 hover:bg-sand-50 transition">
      <div className="flex items-center gap-2 mb-2">
        <span className={`w-2 h-2 rounded-full ${toneMap.badge}`} />
        <span className="text-[10px] font-extrabold tabular-nums uppercase tracking-widest text-text-muted">{waitMin}{t("common.minutes")}</span>
        <span className={`ml-auto text-[10px] font-extrabold uppercase tracking-widest ${toneMap.text}`}>
          {isStuck ? t("floor.stuck") : isReady ? t("floor.readyToServe") : t("floor.preparing")}
        </span>
      </div>
      <div className="flex items-start gap-2.5">
        <div className={`flex-shrink-0 w-11 h-11 rounded-lg ${toneMap.badge} text-white flex items-center justify-center text-xs font-extrabold`}>
          {order.tableNumber ? `T${order.tableNumber}` : getOrderTag(order)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-extrabold text-text-primary leading-tight">
            #{order.orderNumber}
            {order.items.length > 0 && <span className="font-medium text-text-secondary"> — {order.items.slice(0, 2).map((i) => i.name).join(", ")}</span>}
          </p>
          <p className="text-[11px] text-text-muted mt-1 font-medium">
            {session?.waiterName || t("floor.noWaiter")}
          </p>
        </div>
      </div>
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CENTER — FLOOR MAP + TABLE CARDS
// ═══════════════════════════════════════════════════════════════════

function FloorMap({
  tables, sessions, orders, alerts, allStaff, mode, onChangeMode, now, onSelect,
}: {
  tables: TableState[];
  sessions: SessionInfo[];
  orders: LiveOrder[];
  alerts: FloorAlert[];
  allStaff: StaffInfo[];
  mode: FloorMode;
  onChangeMode: (m: FloorMode) => void;
  now: number;
  onSelect: (tb: TableState) => void;
}) {
  const { t } = useLanguage();
  // Mobile collapse — the grid eats most of the viewport on small
  // phones, pushing attention queue and staff radar below the fold.
  // Default collapsed on mobile, expanded on desktop. Persists across
  // refreshes per device so the FM doesn't have to retoggle every shift.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const saved = window.localStorage.getItem("floor.mapCollapsed");
    if (saved === "1") return true;
    if (saved === "0") return false;
    // First visit: collapsed on mobile widths, expanded on tablet/desktop.
    return window.matchMedia("(max-width: 767px)").matches;
  });
  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { window.localStorage.setItem("floor.mapCollapsed", next ? "1" : "0"); } catch {}
      return next;
    });
  };
  const waiterColorIndex = useMemo(() => {
    const m = new Map<string, number>();
    allStaff.filter((s) => s.role === "WAITER").forEach((s, i) => m.set(s.id, i % WAITER_PALETTE.length));
    return m;
  }, [allStaff]);

  const occupied = tables.filter((tb) => tb.status !== "empty").length;
  const alertCount = alerts.length;

  return (
    <div className="rounded-2xl bg-white border border-sand-200 p-3">
      {/* Header stacks on mobile (title row + mode pills on their own row),
          inline on md+. Mode pills become a scrollable segmented control so
          they never overflow regardless of viewport width. */}
      <div className="mb-2.5 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <button
          onClick={toggle}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand tables" : "Collapse tables"}
          className="flex items-center gap-3 text-left active:opacity-70 transition"
        >
          <span className="w-7 h-7 rounded-lg bg-sand-100 flex items-center justify-center flex-shrink-0">
            <svg
              className={`w-4 h-4 text-text-secondary transition-transform ${collapsed ? "" : "rotate-90"}`}
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </span>
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-text-muted">{t("floor.floor")}</p>
            <p className="text-sm font-extrabold text-text-primary tabular-nums">
              {occupied}/{tables.length} {t("floor.tables").toLowerCase()}
              {collapsed && alertCount > 0 && (
                <span className="ml-2 text-status-bad-600">· {alertCount} alert{alertCount === 1 ? "" : "s"}</span>
              )}
            </p>
          </div>
        </button>
        <div className={`flex items-center gap-0.5 p-0.5 rounded-lg bg-sand-100 overflow-x-auto no-scrollbar self-stretch md:self-auto ${collapsed ? "hidden md:flex" : ""}`}>
          {(["status", "age", "revenue", "waiter"] as FloorMode[]).map((m) => (
            <button key={m} onClick={() => onChangeMode(m)}
              className={`flex-1 md:flex-initial px-2.5 h-7 rounded-md text-[10px] font-semibold uppercase tracking-wider transition whitespace-nowrap ${
                mode === m ? "bg-white text-text-primary shadow-sm" : "text-text-secondary hover:text-text-secondary"
              }`}>
              {t(`floor.mode.${m}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Table grid — denser than the waiter's so the FM gets a
          floor-wide read in one glance. 4 cols on phones, 5 on small
          tablets, auto-fill at 95px on bigger screens. Tile typography
          dials back inside TableCard so the table number still reads. */}
      <div className={`grid grid-cols-4 sm:grid-cols-5 md:grid-cols-[repeat(auto-fill,minmax(95px,1fr))] gap-1.5 sm:gap-2 ${collapsed ? "hidden" : ""}`}>
        {tables.map((table) => {
          const session = sessions.find((s) => s.tableNumber === table.id && s.status === "OPEN");
          const order = orders.find((o) => o.tableNumber === table.id && !["paid", "cancelled", "served"].includes(o.status));
          const hasAlert = alerts.some((a) => a.tableNumber === table.id);
          return (
            <TableCard
              key={table.id}
              table={table}
              session={session}
              order={order}
              hasAlert={hasAlert}
              mode={mode}
              waiterColor={session?.waiterId ? WAITER_PALETTE[waiterColorIndex.get(session.waiterId) ?? 0] : undefined}
              now={now}
              onClick={() => onSelect(table)}
            />
          );
        })}
      </div>

      {/* Mode-appropriate legend */}
      <div className="mt-3 flex flex-wrap gap-2 text-[9px] text-text-muted">
        {mode === "status" && (
          [
            { c: "bg-sand-300", l: t("floor.idle") },
            { c: "bg-status-info-400", l: t("floor.seated") },
            { c: "bg-status-warn-500", l: t("floor.ordered") },
            { c: "bg-status-good-500", l: t("floor.served") },
            { c: "bg-status-wait-500", l: t("floor.bill") },
          ].map((s) => (
            <span key={s.l} className="flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${s.c}`} />{s.l}</span>
          ))
        )}
        {mode === "age" && (
          [
            { c: "bg-status-info-400", l: "<15m" },
            { c: "bg-status-good-400", l: "15–45m" },
            { c: "bg-status-warn-400", l: "45–75m" },
            { c: "bg-status-bad-400", l: ">75m" },
          ].map((s) => (
            <span key={s.l} className="flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${s.c}`} />{s.l}</span>
          ))
        )}
        {mode === "revenue" && (
          [
            { c: "bg-sand-300", l: "<200" },
            { c: "bg-status-good-300", l: "200–500" },
            { c: "bg-status-good-400", l: "500–1k" },
            { c: "bg-status-good-500", l: "1k+" },
          ].map((s) => (
            <span key={s.l} className="flex items-center gap-1"><span className={`w-1.5 h-1.5 rounded-full ${s.c}`} />{s.l} {t("common.egp")}</span>
          ))
        )}
        {mode === "waiter" && allStaff.filter((s) => s.role === "WAITER").map((s, i) => (
          <span key={s.id} className={`flex items-center gap-1 px-1.5 py-0.5 rounded ${WAITER_PALETTE[i % WAITER_PALETTE.length]}`}>
            <span className="font-semibold">{initials(s.name)}</span>
            <span className="font-bold">{s.name}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

function TableCard({
  table, session, order, hasAlert, mode, waiterColor, now, onClick,
}: {
  table: TableState;
  session?: SessionInfo;
  order?: LiveOrder;
  hasAlert: boolean;
  mode: FloorMode;
  waiterColor?: string;
  now: number;
  onClick: () => void;
}) {
  const seatedMin = session ? Math.max(0, Math.round((now - new Date(session.openedAt).getTime()) / 60000)) : 0;
  const orderWaitMin = order ? Math.max(0, Math.round((now - order.createdAt) / 60000)) : 0;
  const unpaid = Math.round(session?.unpaidTotal || 0);

  // Background by mode
  let bgClass = `${TABLE_COLORS[table.status]?.bg || "bg-white"} border-sand-200`;
  if (mode === "age" && table.status !== "empty") {
    bgClass = seatedMin < 15 ? "bg-status-info-50 border-status-info-200"
      : seatedMin < 45 ? "bg-status-good-50 border-status-good-200"
      : seatedMin < 75 ? "bg-status-warn-50 border-status-warn-200"
      : "bg-status-bad-50 border-status-bad-200";
  } else if (mode === "revenue" && unpaid > 0) {
    bgClass = unpaid >= 1000 ? "bg-status-good-100 border-status-good-300"
      : unpaid >= 500 ? "bg-status-good-50 border-status-good-200"
      : unpaid >= 200 ? "bg-status-good-50 border-status-good-200"
      : "bg-sand-50 border-sand-200";
  } else if (mode === "waiter" && waiterColor) {
    bgClass = waiterColor;
  }

  const accentClass = TABLE_ACCENT[table.status] || "bg-sand-200";

  return (
    <motion.button
      onClick={onClick}
      whileTap={{ scale: 0.96 }}
      className={`relative aspect-square rounded-xl border-2 ${bgClass} overflow-hidden flex flex-col transition-all hover:shadow-md ${hasAlert ? "ring-2 ring-status-bad-400 ring-offset-2 ring-offset-white" : ""}`}
    >
      {/* Top row — table number is the hero. Eyebrow + giant number.
          Typography tightens on dense layouts (mobile/tablet) and
          opens up on desktop where tiles are larger. */}
      <div className="flex-1 flex flex-col items-center justify-center leading-none gap-0.5">
        <span className="text-[7px] sm:text-[8px] font-extrabold text-text-muted uppercase tracking-[0.2em]">T</span>
        <span className="text-3xl md:text-4xl font-extrabold text-text-primary tabular-nums tracking-tight leading-none">{table.id}</span>
        {session?.waiterName && mode !== "waiter" && (
          <span className="text-[9px] md:text-[10px] font-extrabold text-ocean-600 tracking-wider mt-0.5">{initials(session.waiterName)}</span>
        )}
        {mode === "age" && table.status !== "empty" && (
          <span className="text-[10px] md:text-[11px] font-extrabold tabular-nums text-text-secondary mt-0.5">{seatedMin}m</span>
        )}
        {mode === "revenue" && unpaid > 0 && (
          <span className="text-[10px] md:text-[11px] font-extrabold tabular-nums text-status-good-700 mt-0.5">{unpaid}</span>
        )}
      </div>

      {/* Bottom metadata strip */}
      {table.status !== "empty" && (
        <div className="px-1.5 py-0.5 flex items-center justify-between text-[9px] text-text-secondary font-extrabold">
          <span className="tabular-nums">{table.guestCount}g</span>
          {mode !== "age" && <span className="tabular-nums">{seatedMin}m</span>}
          {unpaid > 0 && mode !== "revenue" && <span className="tabular-nums text-status-good-600">{unpaid}</span>}
        </div>
      )}

      {/* Status accent strip */}
      <div className={`absolute bottom-0 left-0 right-0 h-1 ${accentClass}`} />

      {/* Alert dot — solid, no heartbeat. The table's ring + the
          attention queue already signal urgency. */}
      {hasAlert && <div className="absolute top-1 right-1 w-2.5 h-2.5 rounded-full bg-status-bad-500" />}
      {/* Order-wait badge (critical only) */}
      {orderWaitMin > 15 && (
        <div className="absolute top-0.5 left-0.5 text-[8px] font-semibold text-white bg-status-bad-500 px-1 rounded tabular-nums">
          {orderWaitMin}m
        </div>
      )}
    </motion.button>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CENTER — HIGH-VALUE + VIP
// ═══════════════════════════════════════════════════════════════════

function HighValueSpotlight({ highValue, tables, now, onSelect }: {
  highValue: SessionInfo[];
  tables: TableState[];
  now: number;
  onSelect: (tb: TableState) => void;
}) {
  const { t } = useLanguage();
  if (highValue.length === 0) return null;
  return (
    <div className="rounded-2xl bg-gradient-to-r from-status-warn-50 via-white to-white border border-status-warn-200 p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">★</span>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-status-warn-700">{t("floor.highValue")}</p>
        <p className="ml-auto text-[9px] text-status-warn-600">{t("floor.highValueHint")}</p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {highValue.map((s) => {
          const tb = tables.find((t) => t.id === s.tableNumber);
          const age = Math.max(0, Math.round((now - new Date(s.openedAt).getTime()) / 60000));
          return (
            <button key={s.id}
              onClick={() => tb && onSelect(tb)}
              className="rounded-xl bg-white border border-status-warn-200 p-2.5 text-left hover:shadow-md active:scale-[0.98] transition">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-semibold text-text-primary">T{s.tableNumber}</span>
                {s.vipGuestName && <span className="text-[9px] font-semibold text-status-wait-600 truncate">★ {s.vipGuestName}</span>}
                <span className="ml-auto text-[9px] text-text-muted tabular-nums">{age}{t("common.minutes")}</span>
              </div>
              <p className="text-base font-semibold tabular-nums text-status-warn-700 mt-0.5">
                {Math.round(s.unpaidTotal || 0).toLocaleString()}
                <span className="text-[9px] opacity-60 ml-1">{t("common.egp")}</span>
              </p>
              <p className="text-[9px] text-text-secondary truncate">{s.waiterName || t("floor.noWaiter")} · {s.guestCount}{t("floor.guestAbbrev")}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function VipSection({ vipSessions, now, onSelect }: {
  vipSessions: SessionInfo[];
  now: number;
  onSelect: (s: SessionInfo) => void;
}) {
  const { t } = useLanguage();
  if (vipSessions.length === 0) return null;
  return (
    <div className="rounded-2xl bg-white border border-status-wait-200 p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="px-1.5 py-0.5 rounded bg-status-wait-100 text-status-wait-700 text-[9px] font-semibold uppercase tracking-widest">{"\u{1F451}"} VIP</span>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-status-wait-700">{t("floor.activeVip")}</p>
        <p className="ml-auto text-[9px] text-status-wait-400 tabular-nums">{vipSessions.length}</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {vipSessions.map((s) => {
          const elapsed = Math.max(0, Math.round((now - new Date(s.openedAt).getTime()) / 60000));
          const isDelivery = s.orderType === "DELIVERY";
          return (
            <button key={s.id}
              onClick={() => onSelect(s)}
              className={`rounded-xl p-2.5 border flex items-center gap-2.5 text-left hover:shadow-md active:scale-[0.99] transition ${isDelivery ? "bg-status-warn-50 border-status-warn-200" : "bg-status-wait-50 border-status-wait-200"}`}>
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-sm font-semibold text-white ${isDelivery ? "bg-status-warn-500" : "bg-status-wait-600"}`}>
                {isDelivery ? "\u{1F6F5}" : "\u{1F451}"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-text-primary truncate">{s.vipGuestName || t("floor.vipGuest")}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-[9px] text-text-muted tabular-nums">{elapsed}{t("common.minutes")}</span>
                  {s.waiterName && <span className="text-[9px] text-text-secondary truncate">· {s.waiterName}</span>}
                </div>
              </div>
              {(s.orderTotal ?? 0) > 0 && (
                <span className="text-xs font-semibold tabular-nums text-status-good-600">{s.orderTotal}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// RIGHT — STAFF LIVE
// ═══════════════════════════════════════════════════════════════════

// Small SVG indicator matching the lightbulb used in the owner dashboard
// staff panel. Green = clocked in, red = not clocked in. Keeps the
// signal consistent across the app so owners and floor managers read
// the same cue.
function ClockBulb({ on }: { on: boolean }) {
  return (
    <span
      title={on ? "Clocked in" : "Not clocked in"}
      aria-label={on ? "Clocked in" : "Not clocked in"}
      className={`inline-flex items-center justify-center w-5 h-5 rounded-full ${on ? "bg-status-good-100" : "bg-status-bad-100"}`}
    >
      <svg viewBox="0 0 24 24" fill="currentColor" className={`w-3 h-3 ${on ? "text-status-good-600 drop-shadow-[0_0_3px_rgba(34,197,94,0.6)]" : "text-status-bad-500"}`}>
        <path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z" />
      </svg>
    </span>
  );
}

function StaffLivePanel({
  waiterMetrics, staffPresence, loadSummary, unassignedSessions,
  onReassign, onMessage, onSelectWaiterTable,
}: {
  waiterMetrics: WaiterMetric[];
  staffPresence: import("./types").StaffPresence[];
  loadSummary: { idle: number; busy: number; heavy: number; overloaded: number; total: number };
  unassignedSessions: SessionInfo[];
  onReassign: (sessionId: string, waiterId: string) => Promise<{ ok: boolean; message?: string }> | void;
  onMessage: (staffId: string) => void;
  onSelectWaiterTable: (s: SessionInfo) => void;
}) {
  const { t } = useLanguage();
  const [openStation, setOpenStation] = useState<string | null>(null);

  // Order waiters: overloaded first (need rebalancing), then heavy,
  // then busy, then idle (have capacity). Off-shift go to the bottom.
  const loadRank: Record<string, number> = { overloaded: 0, heavy: 1, busy: 2, idle: 3 };
  const sortedWaiters = useMemo(
    () =>
      [...waiterMetrics].sort((a, b) => {
        if (a.onShift !== b.onShift) return a.onShift ? -1 : 1;
        return (loadRank[a.load] ?? 4) - (loadRank[b.load] ?? 4);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [waiterMetrics],
  );

  const clockedInCount = waiterMetrics.filter((w) => w.isClockedIn).length;

  // Anomaly callouts — names + counts so the FM acts on a person, not
  // a number. Computed once per render.
  const overloaded = waiterMetrics.filter((w) => w.load === "overloaded");
  const idle = waiterMetrics.filter((w) => w.load === "idle" && w.onShift && w.isClockedIn);
  const late = waiterMetrics.filter((w) => w.onShift && !w.isClockedIn);
  const overtime = waiterMetrics.filter((w) => !w.onShift && w.isClockedIn);
  const hasAnomalies =
    overloaded.length > 0 ||
    late.length > 0 ||
    overtime.length > 0 ||
    unassignedSessions.length > 0;

  // Group other roles for the stations grid at the bottom.
  const grouped: Record<string, import("./types").StaffPresence[]> = {};
  for (const p of staffPresence) {
    (grouped[p.role] = grouped[p.role] || []).push(p);
  }
  const roleOrder = ["CASHIER", "KITCHEN", "BAR", "FLOOR_MANAGER", "DELIVERY"];
  const roleLabels: Record<string, string> = {
    CASHIER: t("floor.role.cashier"),
    KITCHEN: t("floor.role.kitchen"),
    BAR: t("floor.role.bar"),
    FLOOR_MANAGER: t("floor.role.floor"),
    DELIVERY: t("floor.role.delivery"),
  };

  return (
    <div className="rounded-2xl bg-white border border-sand-200 overflow-hidden">
      {/* Header — title + at-a-glance counts */}
      <div className="px-4 py-3 border-b border-sand-100 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-text-primary">{t("floor.staffRadar")}</p>
          <p className="text-[10px] text-text-secondary tabular-nums mt-1 font-bold">
            {waiterMetrics.length > 0
              ? `${clockedInCount}/${waiterMetrics.length} ${t("floor.waiters").toLowerCase()} ${t("floor.clockedInShort")}`
              : t("floor.noStaff")
            }
          </p>
        </div>
        {/* Quick load summary — color dots, not text */}
        {waiterMetrics.length > 0 && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {loadSummary.idle > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-extrabold tabular-nums text-text-secondary">
                <span className="w-2 h-2 rounded-full bg-sand-300" />{loadSummary.idle}
              </span>
            )}
            {loadSummary.busy > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-extrabold tabular-nums text-status-good-700">
                <span className="w-2 h-2 rounded-full bg-status-good-500" />{loadSummary.busy}
              </span>
            )}
            {loadSummary.heavy > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-extrabold tabular-nums text-status-warn-700">
                <span className="w-2 h-2 rounded-full bg-status-warn-500" />{loadSummary.heavy}
              </span>
            )}
            {loadSummary.overloaded > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-extrabold tabular-nums text-status-bad-700">
                <span className="w-2 h-2 rounded-full bg-status-bad-500 animate-pulse" />{loadSummary.overloaded}
              </span>
            )}
          </div>
        )}
      </div>

      {/* ── Anomaly callouts ─────────────────────────────────────
          Surfaces names (not counts) so the FM acts on a specific
          person. Only renders if something's wrong. */}
      {hasAnomalies && (
        <div className="px-4 py-2.5 border-b border-sand-100 bg-sand-50/60 space-y-1.5">
          {unassignedSessions.length > 0 && (
            <AnomalyRow
              tone="warn"
              label={`${unassignedSessions.length} ${t("floor.unassignedSessions").toLowerCase()}`}
            >
              <div className="flex flex-wrap gap-1">
                {unassignedSessions.slice(0, 6).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => onSelectWaiterTable(s)}
                    className="px-2 py-0.5 rounded-md bg-white border border-status-warn-300 text-[11px] font-extrabold text-status-warn-700 hover:bg-status-warn-100 transition tabular-nums"
                  >
                    T{s.tableNumber}
                  </button>
                ))}
                {unassignedSessions.length > 6 && (
                  <span className="px-1.5 py-0.5 text-[10px] font-extrabold text-status-warn-700">
                    +{unassignedSessions.length - 6}
                  </span>
                )}
              </div>
            </AnomalyRow>
          )}
          {overloaded.length > 0 && (
            <AnomalyRow tone="bad" label={`${overloaded.length} ${t("floor.overloaded").toLowerCase()}`}>
              <span className="text-[11px] font-extrabold text-status-bad-700">
                {overloaded.map((w) => w.name.split(" ")[0]).join(", ")}
              </span>
            </AnomalyRow>
          )}
          {late.length > 0 && (
            <AnomalyRow tone="warn" label={t("floor.notClockedInLabel")}>
              <span className="text-[11px] font-extrabold text-status-warn-700">
                {late.map((w) => w.name.split(" ")[0]).join(", ")}
              </span>
            </AnomalyRow>
          )}
          {overtime.length > 0 && (
            <AnomalyRow tone="info" label={t("floor.pastShiftLabel")}>
              <span className="text-[11px] font-extrabold text-status-info-700">
                {overtime.map((w) => w.name.split(" ")[0]).join(", ")}
              </span>
            </AnomalyRow>
          )}
        </div>
      )}

      {/* ── Waiters list ───────────────────────────────────────── */}
      {sortedWaiters.length === 0 ? (
        <div className="p-6 text-center text-[11px] text-text-muted">{t("floor.noStaff")}</div>
      ) : (
        <div className="divide-y divide-sand-100">
          {sortedWaiters.map((w) => (
            <WaiterRow
              key={w.id}
              w={w}
              unassignedSessions={unassignedSessions}
              onReassign={onReassign}
              onMessage={onMessage}
            />
          ))}
        </div>
      )}

      {/* ── Stations health grid ───────────────────────────────── */}
      {Object.keys(grouped).length > 0 && (
        <div className="border-t border-sand-100 p-3 bg-sand-50/40">
          <p className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-text-muted mb-2">
            {t("floor.otherRoles")}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {roleOrder.filter((r) => grouped[r]?.length).map((role) => {
              const members = grouped[role];
              const onShiftClocked = members.filter((p) => p.onShift && p.isClockedIn).length;
              const onShiftTotal = members.filter((p) => p.onShift).length;
              const offShiftClocked = members.filter((p) => !p.onShift && p.isClockedIn).length;
              // Coverage health: green if all on-shift staff are clocked in, amber if some, red if none.
              const tone =
                onShiftTotal === 0 ? "muted"
                : onShiftClocked === 0 ? "bad"
                : onShiftClocked < onShiftTotal ? "warn"
                : "good";
              const toneCls = {
                good: "bg-status-good-50 border-status-good-200 text-status-good-700",
                warn: "bg-status-warn-50 border-status-warn-200 text-status-warn-700",
                bad: "bg-status-bad-50 border-status-bad-200 text-status-bad-700",
                muted: "bg-sand-50 border-sand-200 text-text-secondary",
              }[tone];
              const dotCls = {
                good: "bg-status-good-500",
                warn: "bg-status-warn-500",
                bad: "bg-status-bad-500 animate-pulse",
                muted: "bg-sand-400",
              }[tone];
              const isOpen = openStation === role;
              return (
                <button
                  key={role}
                  onClick={() => setOpenStation(isOpen ? null : role)}
                  className={`text-left p-2.5 rounded-xl border-2 transition active:scale-95 ${toneCls}`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotCls}`} />
                    <span className="text-[10px] font-extrabold uppercase tracking-wider truncate">
                      {roleLabels[role] || role}
                    </span>
                  </div>
                  <div className="text-base font-extrabold tabular-nums leading-none">
                    {onShiftClocked}<span className="text-text-muted">/{onShiftTotal || members.length}</span>
                  </div>
                  {offShiftClocked > 0 && !isOpen && (
                    <div className="text-[9px] text-text-muted font-bold mt-1 truncate">
                      +{offShiftClocked} {t("floor.off").toLowerCase()}
                    </div>
                  )}
                  {isOpen && (
                    <div className="mt-2 pt-2 border-t border-current/20 space-y-0.5">
                      {members.map((p) => (
                        <div key={p.id} className="flex items-center gap-1.5 text-[10px] font-bold">
                          <ClockBulb on={p.isClockedIn} />
                          <span className="truncate flex-1">{p.name}</span>
                          {!p.onShift && <span className="text-[8px] opacity-60 uppercase">{t("floor.off")}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Hint — only when everyone idle and FM might think it's broken */}
      {!hasAnomalies && idle.length > 0 && idle.length === waiterMetrics.filter((w) => w.onShift).length && (
        <div className="px-4 py-2 border-t border-sand-100 bg-status-good-50 text-[10px] font-extrabold text-status-good-700 uppercase tracking-wider text-center">
          {t("floor.allClear")}
        </div>
      )}
    </div>
  );
}

function AnomalyRow({
  tone, label, children,
}: {
  tone: "bad" | "warn" | "info";
  label: string;
  children: React.ReactNode;
}) {
  const dotCls = {
    bad: "bg-status-bad-500 animate-pulse",
    warn: "bg-status-warn-500",
    info: "bg-status-info-500",
  }[tone];
  const labelCls = {
    bad: "text-status-bad-700",
    warn: "text-status-warn-700",
    info: "text-status-info-700",
  }[tone];
  return (
    <div className="flex items-start gap-2">
      <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${dotCls}`} />
      <div className="flex-1 min-w-0">
        <span className={`text-[9px] font-extrabold uppercase tracking-widest ${labelCls}`}>{label}</span>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  );
}

function WaiterRow({
  w, unassignedSessions, onReassign, onMessage,
}: {
  w: WaiterMetric;
  unassignedSessions: SessionInfo[];
  onReassign: (sessionId: string, waiterId: string) => Promise<{ ok: boolean; message?: string }> | void;
  onMessage: (staffId: string) => void;
}) {
  const { t } = useLanguage();
  const [assignError, setAssignError] = useState<string | null>(null);
  const [assignBusy, setAssignBusy] = useState(false);

  // Capacity assumption: 5 tables = 100% load. Overloaded > 100%.
  const loadPct = Math.min(100, (w.tables / 5) * 100);

  const loadBg = w.load === "overloaded" ? "bg-status-bad-500"
    : w.load === "heavy" ? "bg-status-warn-500"
    : w.load === "busy" ? "bg-status-good-500"
    : "bg-sand-300";
  const avatarBg = w.load === "overloaded" ? "bg-status-bad-500"
    : w.load === "heavy" ? "bg-status-warn-500"
    : w.load === "busy" ? "bg-status-good-500"
    : "bg-sand-400";

  // Anomaly framing for the row itself.
  const isOverloaded = w.load === "overloaded";
  const isLate = w.onShift && !w.isClockedIn;
  const isOvertime = !w.onShift && w.isClockedIn;
  const isOff = !w.onShift && !w.isClockedIn;

  const idleWithUnassigned = w.load === "idle" && w.onShift && w.isClockedIn && unassignedSessions.length > 0;

  return (
    <div className={`p-3 ${isOverloaded ? "bg-status-bad-50/30" : isOff ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-2.5">
        {/* Avatar — color encodes load level so you read it without parsing text */}
        <div className={`relative w-12 h-12 rounded-xl flex items-center justify-center text-base font-extrabold text-white flex-shrink-0 ${avatarBg}`}>
          {initials(w.name)}
          {/* Clock-state corner dot — only render when there's an anomaly worth noticing */}
          {(isLate || isOvertime) && (
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white ${
                isLate ? "bg-status-warn-500 animate-pulse" : "bg-status-info-500"
              }`}
              title={isLate ? t("floor.notClockedInLabel") : t("floor.pastShiftLabel")}
            />
          )}
        </div>

        {/* Name + stats */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-1.5">
            <span className="text-sm font-extrabold text-text-primary truncate">{w.name}</span>
            {isLate && (
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-status-warn-700 flex-shrink-0">
                {t("floor.late")}
              </span>
            )}
            {isOvertime && (
              <span className="text-[9px] font-extrabold uppercase tracking-wider text-status-info-700 flex-shrink-0">
                {t("floor.overtime")}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-[11px] text-text-secondary tabular-nums mt-0.5">
            <span><span className="font-extrabold text-text-primary">{w.tables}</span> {t("floor.tables").toLowerCase()}</span>
            <span className="text-sand-300">·</span>
            <span><span className="font-extrabold text-text-primary">{w.activeOrders}</span> {t("floor.activeOrdersShort")}</span>
            {w.openRevenue > 0 && (
              <>
                <span className="text-sand-300">·</span>
                <span className="font-extrabold text-status-good-600">{Math.round(w.openRevenue).toLocaleString()}</span>
              </>
            )}
          </div>
        </div>

        {/* Inline action icons — always visible, no expand. The clock-out
            button used to live here; removed because the auto-clockout
            cron is the only path that closes a shift now. */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => onMessage(w.id)}
            title={t("floor.msg")}
            aria-label={t("floor.msg")}
            className="w-9 h-9 rounded-lg bg-ocean-50 hover:bg-ocean-100 text-ocean-700 flex items-center justify-center active:scale-95 transition"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Always-visible load bar with capacity tick marks */}
      {w.onShift && w.isClockedIn && (
        <div className="mt-2.5 h-2 rounded-full bg-sand-100 overflow-hidden relative">
          <div className={`h-full rounded-full ${loadBg} transition-all`} style={{ width: `${loadPct}%` }} />
          <div className="absolute top-0 bottom-0 w-px bg-white/70" style={{ left: "40%" }} />
          <div className="absolute top-0 bottom-0 w-px bg-white/70" style={{ left: "80%" }} />
        </div>
      )}

      {/* Last activity hint — quiet timestamp */}
      {w.lastActivityMins != null && w.onShift && (
        <p className="text-[10px] text-text-muted tabular-nums mt-1.5 font-medium">
          {t("floor.lastOrder")} {w.lastActivityMins}{t("common.minutes")} {t("floor.ago")}
        </p>
      )}

      {/* One-tap rebalance — only when this idle waiter could take a real unassigned table */}
      {idleWithUnassigned && unassignedSessions[0] && (
        <>
          <button
            disabled={assignBusy}
            onClick={async () => {
              setAssignError(null);
              setAssignBusy(true);
              const result = await onReassign(unassignedSessions[0].id, w.id);
              setAssignBusy(false);
              if (result && result.ok === false) setAssignError(result.message || "Assign failed");
            }}
            className="mt-2.5 w-full h-10 rounded-lg bg-status-good-500 hover:bg-status-good-600 text-white text-[11px] font-extrabold uppercase tracking-wider active:scale-95 transition disabled:opacity-50"
          >
            {t("floor.assignTable")} T{unassignedSessions[0].tableNumber} → {w.name.split(" ")[0]}
          </button>
          {assignError && (
            <div className="mt-1.5 px-2.5 py-1.5 rounded-lg bg-status-bad-50 border border-status-bad-200 text-status-bad-700 text-[10px] font-semibold">
              {assignError}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// RIGHT — KITCHEN / BAR STATION PANEL
// ═══════════════════════════════════════════════════════════════════

function StationPanel({
  label, capacity, activeCount, avgPrep, stuckCount, oldest, now, onPrioritizeOldest, onOpenOrder,
}: {
  label: string;
  capacity: number;
  activeCount: number;
  avgPrep: number;
  stuckCount: number;
  oldest: LiveOrder | null;
  now: number;
  onPrioritizeOldest?: (o: LiveOrder) => void;
  onOpenOrder?: (o: LiveOrder) => void;
}) {
  const { t } = useLanguage();
  const tone = capacity > 85 ? "rose" : capacity > 60 ? "amber" : "emerald";
  const toneMap = {
    rose: { text: "text-status-bad-600", bg: "bg-status-bad-500", dot: "bg-status-bad-500" },
    amber: { text: "text-status-warn-600", bg: "bg-status-warn-500", dot: "bg-status-warn-500" },
    emerald: { text: "text-status-good-600", bg: "bg-status-good-500", dot: "bg-status-good-500" },
  }[tone];

  return (
    <div className="rounded-2xl bg-white border border-sand-200 p-3">
      <div className="flex items-center gap-2 mb-3">
        <span className={`w-2.5 h-2.5 rounded-full ${toneMap.dot}`} />
        <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-text-primary flex-1">{label}</p>
        <span className={`text-lg font-extrabold tabular-nums tracking-tight ${toneMap.text}`}>{Math.round(capacity)}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-sand-100 overflow-hidden mb-3">
        <div className={`h-full rounded-full ${toneMap.bg} transition-all duration-500`} style={{ width: `${Math.min(100, capacity)}%` }} />
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <p className="text-[9px] font-extrabold uppercase tracking-widest text-text-muted mb-1">{t("floor.active")}</p>
          <p className="text-xl font-extrabold tabular-nums text-text-primary leading-none">{activeCount}</p>
        </div>
        <div>
          <p className="text-[9px] font-extrabold uppercase tracking-widest text-text-muted mb-1">{t("floor.avgPrep")}</p>
          <p className="text-xl font-extrabold tabular-nums text-text-primary leading-none">{Math.round(avgPrep)}{t("common.minutes")}</p>
        </div>
        <div>
          <p className="text-[9px] font-extrabold uppercase tracking-widest text-text-muted mb-1">{t("floor.stuck")}</p>
          <p className={`text-xl font-extrabold tabular-nums leading-none ${stuckCount > 0 ? "text-status-bad-600" : "text-text-primary"}`}>{stuckCount}</p>
        </div>
      </div>

      {/* Oldest ticket — inline action */}
      {oldest && onPrioritizeOldest && onOpenOrder && (
        <div className="mt-3 pt-3 border-t border-sand-100">
          <p className="text-[9px] font-extrabold uppercase tracking-widest text-text-muted mb-1.5">{t("floor.oldestTicket")}</p>
          <button onClick={() => onOpenOrder(oldest)}
            className="w-full text-left rounded-lg bg-sand-50 p-2.5 hover:bg-sand-100 transition">
            <div className="flex items-center gap-2">
              <span className="text-sm font-extrabold text-text-primary">#{oldest.orderNumber}</span>
              {oldest.tableNumber && <span className="text-[11px] text-text-secondary font-bold">T{oldest.tableNumber}</span>}
              <span className="ml-auto text-xs font-extrabold text-status-bad-600 tabular-nums">
                {Math.max(0, Math.round((now - oldest.createdAt) / 60000))}{t("common.minutes")}
              </span>
            </div>
            <p className="text-[11px] text-text-secondary truncate mt-0.5 font-medium">
              {oldest.items.slice(0, 2).map((i) => i.name).join(", ")}
            </p>
          </button>
          <button onClick={() => onPrioritizeOldest(oldest)}
            className="mt-2 w-full py-2 rounded-lg bg-status-warn-500 text-white text-[11px] font-extrabold uppercase tracking-wider active:scale-95 transition">
            {t("floor.prioritize")}
          </button>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// RIGHT — DELIVERY
// ═══════════════════════════════════════════════════════════════════

function DeliveryLivePanel({
  deliveries, unassignedCount, drivers, onAssign, onUpdateStatus,
}: {
  deliveries: DeliveryOrder[];
  unassignedCount: number;
  drivers: StaffInfo[];
  onAssign: (orderId: string, driverId: string) => void;
  onUpdateStatus: (orderId: string, status: string) => void;
}) {
  const { t } = useLanguage();
  const active = deliveries.filter((d) => d.deliveryDriverId && d.deliveryStatus !== "DELIVERED" && d.status !== "PAID" && d.status !== "CANCELLED");
  const unassigned = deliveries.filter((d) => !d.deliveryDriverId && d.status !== "PENDING" && d.status !== "CANCELLED" && d.status !== "PAID");
  const onlineDrivers = drivers.length;

  return (
    <div className="rounded-2xl bg-white border border-sand-200">
      <div className="px-4 py-3 border-b border-sand-100 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-text-primary">{t("floor.delivery")}</p>
          <p className="text-[10px] text-text-secondary tabular-nums mt-1 font-medium">
            {onlineDrivers} {onlineDrivers === 1 ? t("floor.driverShort") : t("floor.driversShort")} · {active.length} {t("floor.active").toLowerCase()}
            {unassignedCount > 0 && <span className="text-status-bad-600 font-extrabold"> · {unassignedCount} {t("floor.unassigned")}</span>}
          </p>
        </div>
      </div>

      {deliveries.length === 0 ? (
        <div className="p-6 text-center text-[11px] text-text-muted">{t("floor.noDeliveries")}</div>
      ) : (
        <div className="p-3 space-y-2 max-h-[50vh] overflow-y-auto no-scrollbar">
          {unassigned.map((dlv) => (
            <DeliveryCard key={dlv.id} delivery={dlv} drivers={drivers} onAssign={onAssign} onUpdateStatus={onUpdateStatus} />
          ))}
          {active.map((dlv) => (
            <DeliveryCard key={dlv.id} delivery={dlv} drivers={drivers} onAssign={onAssign} onUpdateStatus={onUpdateStatus} />
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// RIGHT — PAYMENT QUEUE (ex-Cashiers tab)
// Tables in waiting_bill / paying status with their unpaid totals.
// The old Cashiers tab buried this; now it sits next to delivery
// because both are handoff queues the floor mgr watches.
// ═══════════════════════════════════════════════════════════════════

function PaymentQueuePanel({
  sessions, tables, onSelect,
}: {
  sessions: SessionInfo[];
  tables: TableState[];
  onSelect: (tb: TableState) => void;
}) {
  const { t } = useLanguage();
  const queue = sessions
    .filter((s) => s.tableNumber != null)
    .map((s) => ({ s, tb: tables.find((t) => t.id === s.tableNumber) }))
    .filter((x): x is { s: SessionInfo; tb: TableState } => !!x.tb && (x.tb.status === "waiting_bill" || x.tb.status === "paying"));
  const unpaidTotal = queue.reduce((acc, { s }) => acc + (s.unpaidTotal || 0), 0);

  return (
    <div className="rounded-2xl bg-white border border-sand-200">
      <div className="px-4 py-3 border-b border-sand-100 flex items-center justify-between">
        <div>
          <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-text-primary">{t("floor.paymentQueue")}</p>
          <p className="text-[10px] text-text-secondary tabular-nums mt-1 font-medium">
            {queue.length === 0
              ? t("floor.noTablesAwaiting")
              : `${queue.length} ${queue.length === 1 ? t("floor.tableShort") : t("floor.tablesShort")} · ${Math.round(unpaidTotal).toLocaleString()} ${t("common.egp")}`}
          </p>
        </div>
      </div>
      {queue.length === 0 ? (
        <div className="p-4 text-center text-[11px] text-text-muted">{t("floor.allPaid")}</div>
      ) : (
        <div className="p-3 space-y-2">
          {queue.map(({ s, tb }) => {
            const isPaying = tb.status === "paying";
            return (
              <button key={s.id} onClick={() => onSelect(tb)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition border-2 ${
                  isPaying ? "bg-status-bad-50 border-status-bad-200 hover:bg-status-bad-100" : "bg-status-wait-50 border-status-wait-200 hover:bg-status-wait-100"
                }`}>
                <span className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-extrabold text-white flex-shrink-0 ${isPaying ? "bg-status-bad-500" : "bg-status-wait-500"}`}>
                  T{tb.id}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-extrabold text-text-primary truncate">
                    {s.waiterName || t("floor.noWaiter")}
                    <span className="font-medium text-text-secondary ml-1">· {s.guestCount}{t("floor.guestAbbrev")}</span>
                  </p>
                  <p className={`text-[10px] font-extrabold uppercase tracking-wider mt-0.5 ${isPaying ? "text-status-bad-600" : "text-status-wait-600"}`}>
                    {isPaying ? t("floor.paying") : t("floor.billRequested")}
                  </p>
                </div>
                {(s.unpaidTotal ?? 0) > 0 && (
                  <span className="text-base font-extrabold tabular-nums text-status-good-600 tracking-tight">
                    {Math.round(s.unpaidTotal || 0).toLocaleString()}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// FOOTER — QUICK COMMS
// ═══════════════════════════════════════════════════════════════════

const QuickCommsBar = ({ ref, text, setText, target, setTarget, staff, recentMessages, onSend }: {
  ref: React.RefObject<HTMLInputElement | null>;
  text: string;
  setText: (v: string) => void;
  target: string;
  setTarget: (v: string) => void;
  staff: StaffInfo[];
  recentMessages: RecentMessage[];
  onSend: (text: string) => void;
}) => {
  const { t } = useLanguage();
  const quick = [
    t("floor.quick.rush"),
    t("floor.quick.closing"),
    t("floor.quick.lastCall"),
    t("floor.quick.meeting"),
  ];
  const latest = recentMessages.slice(0, 3);

  const send = () => {
    if (!text.trim()) return;
    onSend(text.trim());
    setText("");
  };

  return (
    <footer className="h-12 flex-shrink-0 border-t border-sand-200 bg-white flex items-center gap-2 px-3">
      {/* Latest message tail (desktop only) */}
      {latest.length > 0 && (
        <div className="hidden md:flex items-center gap-1.5 max-w-xs overflow-hidden">
          <span className="text-[9px] font-semibold uppercase tracking-widest text-text-muted flex-shrink-0">{t("floor.latest")}</span>
          <span className="text-[11px] text-text-secondary truncate">
            <b className="text-text-secondary">{latest[0].fromName || latest[0].from}</b> → {latest[0].toName || latest[0].to}: {latest[0].text}
          </span>
        </div>
      )}

      {/* Quick-send input with target selector */}
      <div className="flex-1 flex items-center gap-2">
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          className="h-8 px-2 rounded-lg bg-sand-100 border border-sand-200 text-[11px] font-bold text-text-secondary focus:outline-none focus:border-ocean-400"
        >
          <option value="all">{t("floor.toAll")}</option>
          {staff.filter((s) => s.active).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <div className="flex-1 flex items-center gap-1 px-2 h-8 rounded-lg bg-sand-100 border border-sand-200 focus-within:border-ocean-400 focus-within:bg-white transition">
          <span className="text-[9px] font-semibold text-text-muted tracking-wider">/</span>
          <input
            ref={ref}
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") send(); }}
            placeholder={t("floor.commsPlaceholder")}
            className="flex-1 bg-transparent border-none outline-none text-xs text-text-primary placeholder:text-text-muted"
          />
          {quick.map((q) => (
            <button key={q} onClick={() => { setText(q); setTimeout(send, 0); }}
              className="hidden lg:inline-flex text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-white border border-sand-200 text-text-secondary hover:text-text-primary transition">
              {q}
            </button>
          ))}
        </div>
        <button
          onClick={send}
          disabled={!text.trim()}
          className="h-8 px-3 rounded-lg bg-ocean-600 text-white text-[11px] font-semibold uppercase tracking-wider disabled:opacity-40 active:scale-95 transition"
        >
          {t("floor.send")}
        </button>
      </div>
    </footer>
  );
};
QuickCommsBar.displayName = "QuickCommsBar";

// ═══════════════════════════════════════════════════════════════════
// DRAWERS — SHIFT SNAPSHOT + ACTION HISTORY
// ═══════════════════════════════════════════════════════════════════

function ShiftSnapshotDrawer({
  staff, occupied, totalTables, guests, revenueToday, revenuePerHour,
  openSessions, deliveries, orders, actionHistory, onClose,
}: {
  staff: LoggedInStaff;
  occupied: number;
  totalTables: number;
  guests: number;
  revenueToday: number;
  revenuePerHour: number;
  openSessions: SessionInfo[];
  deliveries: DeliveryOrder[];
  orders: LiveOrder[];
  actionHistory: import("./types").ActionLogEntry[];
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const stuck = orders.filter((o) => o.status === "preparing" && minsAgo(o.createdAt) > 15);
  const unfinishedDeliveries = deliveries.filter((d) => d.deliveryStatus !== "DELIVERED" && d.status !== "PAID" && d.status !== "CANCELLED");
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-sand-900/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        transition={{ type: "spring", damping: 25 }}
        className="w-full sm:max-w-2xl bg-white rounded-t-3xl sm:rounded-3xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-sand-100 px-5 py-3 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">{t("floor.shiftSnapshot")}</p>
            <p className="text-sm font-semibold text-text-primary">{staff.name} · {new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => window.print()} className="px-3 py-1.5 rounded-lg bg-ocean-600 text-white text-[11px] font-bold active:scale-95">{t("floor.print")}</button>
            <button onClick={onClose} className="w-8 h-8 rounded-lg text-text-muted hover:bg-sand-100 text-lg">×</button>
          </div>
        </div>
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-4 gap-2">
            <SnapshotStat label={t("floor.tables")} value={`${occupied}/${totalTables}`} />
            <SnapshotStat label={t("floor.guests")} value={guests} />
            <SnapshotStat label={t("floor.revenue")} value={Math.round(revenueToday).toLocaleString()} />
            <SnapshotStat label={t("floor.paceHr")} value={revenuePerHour.toLocaleString()} />
          </div>

          <SnapshotList
            title={`${t("floor.openTables")} (${openSessions.length})`}
            empty={t("floor.noOpenTables")}
            items={openSessions
              .slice()
              .sort((a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime())
              .map((s) => ({
                key: s.id,
                prefix: `T${s.tableNumber ?? "?"}`,
                middle: `${s.waiterName || "—"} · ${s.guestCount}${t("floor.guestAbbrev")}`,
                suffix: `${minsAgo(new Date(s.openedAt).getTime())}${t("common.minutes")}`,
                trail: (s.unpaidTotal ?? 0) > 0 ? `${Math.round(s.unpaidTotal || 0)}` : undefined,
              }))}
          />

          {unfinishedDeliveries.length > 0 && (
            <SnapshotList
              title={t("floor.unfinishedDeliveries")}
              items={unfinishedDeliveries.map((dlv) => ({
                key: dlv.id,
                prefix: `#${dlv.orderNumber}`,
                middle: dlv.vipGuestName || "—",
                suffix: dlv.deliveryStatus?.replace(/_/g, " ") || "—",
                trail: `${minsAgo(new Date(dlv.createdAt).getTime())}${t("common.minutes")}`,
              }))}
            />
          )}

          {stuck.length > 0 && (
            <SnapshotList
              title={t("floor.stuckOrders")}
              tone="rose"
              items={stuck.map((o) => ({
                key: o.id,
                prefix: `#${o.orderNumber}`,
                middle: o.tableNumber ? `T${o.tableNumber}` : "",
                suffix: `${minsAgo(o.createdAt)}${t("common.minutes")}`,
              }))}
            />
          )}

          <SnapshotList
            title={`${t("floor.myActions")} (${actionHistory.length})`}
            empty={t("floor.noActionsYet")}
            scroll
            items={actionHistory.slice(0, 15).map((a) => ({
              key: a.id,
              prefix: new Date(a.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
              middle: a.label,
            }))}
          />
        </div>
      </motion.div>
    </motion.div>
  );
}

function SnapshotStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-sand-50 border border-sand-100 p-3">
      <p className="text-[9px] font-semibold uppercase tracking-widest text-text-muted">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-text-primary">{value}</p>
    </div>
  );
}

function SnapshotList({
  title, items, empty, scroll, tone = "slate",
}: {
  title: string;
  items: { key: string; prefix: string; middle: string; suffix?: string; trail?: string }[];
  empty?: string;
  scroll?: boolean;
  tone?: "slate" | "rose";
}) {
  const toneCls = tone === "rose" ? "text-status-bad-600" : "text-text-secondary";
  const rowBg = tone === "rose" ? "bg-status-bad-50 border-status-bad-100" : "bg-sand-50";
  return (
    <div>
      <p className={`text-[10px] font-semibold uppercase tracking-widest mb-2 ${toneCls}`}>{title}</p>
      {items.length === 0 ? (
        <p className="text-[11px] text-text-muted">{empty}</p>
      ) : (
        <div className={`space-y-1 ${scroll ? "max-h-48 overflow-y-auto" : ""}`}>
          {items.map((it) => (
            <div key={it.key} className={`flex items-center gap-2 text-[11px] px-2.5 py-1.5 rounded-lg ${rowBg} ${tone === "rose" ? "border" : ""}`}>
              <span className="font-semibold tabular-nums w-14">{it.prefix}</span>
              <span className="flex-1 text-text-secondary truncate">{it.middle}</span>
              {it.suffix && <span className="text-text-secondary tabular-nums">{it.suffix}</span>}
              {it.trail && <span className="font-semibold text-status-good-600 tabular-nums">{it.trail}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ActionHistoryDrawer({
  actionHistory, onClose,
}: {
  actionHistory: import("./types").ActionLogEntry[];
  onClose: () => void;
}) {
  const { t } = useLanguage();
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-sand-900/60 flex items-end sm:items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <motion.div initial={{ y: 40, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 40, opacity: 0 }}
        transition={{ type: "spring", damping: 25 }}
        className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 bg-white border-b border-sand-100 px-5 py-3 flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">{t("floor.actionHistory")}</p>
            <p className="text-[11px] text-text-secondary">{t("floor.actionHistoryHint")}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg text-text-muted hover:bg-sand-100 text-lg">×</button>
        </div>
        <div className="p-3 space-y-1">
          {actionHistory.length === 0 ? (
            <p className="text-center text-[11px] text-text-muted py-8">{t("floor.noActionsYet")}</p>
          ) : actionHistory.map((a) => (
            <div key={a.id} className="flex items-center gap-2 text-[11px] px-3 py-2 rounded-lg bg-sand-50">
              <span className="text-text-muted w-14 tabular-nums font-mono">{new Date(a.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              <span className="text-text-secondary flex-1">{a.label}</span>
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
