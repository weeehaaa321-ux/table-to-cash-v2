"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePerception, type LiveOrder } from "@/lib/engine/perception";
import { useLiveData } from "@/lib/use-live-data";
import { useMenu } from "@/store/menu";
import LogoutButton from "@/presentation/components/ui/LogoutButton";
import { getShiftTimer, getShiftLabel } from "@/lib/shifts";
import SchedulePopup from "@/presentation/components/ui/SchedulePopup";
import { OrderHistoryDrawer } from "@/presentation/components/ui/OrderHistoryDrawer";
import { ClockButton } from "@/presentation/components/ui/ClockButton";
import { StaffHeaderMenu } from "@/presentation/components/ui/StaffHeaderMenu";
import { getOrderTag } from "@/lib/order-label";
import { staffFetch } from "@/lib/staff-fetch";
import { translateToArabic } from "@/lib/translate-notes";
import { useLanguage } from "@/lib/use-language";
import { LanguageToggle } from "@/presentation/components/ui/LanguageToggle";

type StaffInfo = { id: string; name: string; role: string; shift: number };

// ═══════════════════════════════════════════════════════
// BAR — Drink preparation station
// Mirrors the /kitchen UI, filtered to station === "BAR".
// ═══════════════════════════════════════════════════════

type PriorityLevel = "critical" | "high" | "normal" | "low";

function computePriority(order: LiveOrder, now: number): { level: PriorityLevel; score: number } {
  const waitMin = (now - order.createdAt) / 60000;
  let score = 0;
  if (waitMin > 15) score += 100;
  else if (waitMin > 8) score += 60;
  else if (waitMin > 4) score += 30;
  else score += Math.round(waitMin * 3);
  if (order.total > 400) score += 8;
  if (order.isDelayed) score += 50;
  if (order.status === "pending") score += 20;
  if (order.status === "confirmed") score += 10;
  const level: PriorityLevel =
    score >= 80 ? "critical" : score >= 45 ? "high" : score < 15 ? "low" : "normal";
  return { level, score };
}

function fmtWait(ms: number): string {
  return `${Math.round(ms / 60000)}m`;
}

const PRIORITY_DOT: Record<PriorityLevel, string> = {
  critical: "bg-status-bad-500",
  high: "bg-status-warn-500",
  normal: "bg-sand-300",
  low: "bg-sand-200",
};

const STATUS_PILL: Record<string, { bg: string; text: string; label: string }> = {
  pending: { bg: "bg-status-warn-100", text: "text-status-warn-700", label: "Pending" },
  confirmed: { bg: "bg-status-info-100", text: "text-status-info-700", label: "Accepted" },
  preparing: { bg: "bg-status-wait-100", text: "text-status-wait-700", label: "Pouring" },
  ready: { bg: "bg-status-good-100", text: "text-status-good-700", label: "Ready" },
};

// Whole-card fill per status — at-a-glance state recognition.
// Kept light so existing text colors remain readable.
const STATUS_FILL: Record<string, string> = {
  pending: "bg-status-warn-50",
  confirmed: "bg-status-info-50",
  preparing: "bg-status-wait-50",
  ready: "bg-status-good-50",
  served: "bg-sand-100",
};

function OrderCard({
  order,
  priority,
  now,
  onAdvance,
}: {
  order: LiveOrder;
  priority: { level: PriorityLevel; score: number };
  now: number;
  onAdvance: (id: string) => void;
}) {
  const { lang, t, dir } = useLanguage();
  const waitMs = now - order.createdAt;
  const waitMin = Math.round(waitMs / 60000);

  const nextLabel: Record<string, string> = {
    pending: t("bar.action.accept"),
    confirmed: t("bar.action.startPouring"),
    preparing: t("bar.action.markReady"),
  };
  const action = nextLabel[order.status];

  const borderColor =
    priority.level === "critical" ? "border-l-status-bad-500"
    : priority.level === "high" ? "border-l-status-warn-400"
    : "border-l-sand-200";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -60 }}
      className={`${STATUS_FILL[order.status] || "bg-white"} rounded-xl border border-sand-200 border-l-4 ${borderColor} shadow-sm overflow-hidden`}
    >
      {/* Header — table is the hero (servers route by table, not order #) */}
      <div className="px-6 pt-5 pb-4">
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-text-muted mb-1">
              {t("bar.deliverTo")}
            </div>
            <div className="text-4xl font-extrabold text-text-primary leading-none tracking-tight truncate">
              {getOrderTag(order)}
            </div>
          </div>

          <div className="text-right flex-shrink-0">
            <div className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-text-muted mb-1">
              {t("bar.waiting")}
            </div>
            <div className={`text-3xl font-extrabold tabular-nums leading-none tracking-tight ${
              waitMin > 10 ? "text-status-bad-600"
              : waitMin > 5 ? "text-status-warn-600"
              : "text-text-secondary"
            }`}>
              {fmtWait(waitMs)}
            </div>
          </div>
        </div>

        {order.isDelayed && (
          <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-status-bad-500 text-white text-[10px] font-extrabold uppercase tracking-widest animate-pulse">
            <span>⚠</span>
            {t("bar.delayed")}
          </div>
        )}
      </div>

      {/* Items — quantity prefix + name on a single baseline */}
      <div className="px-6 pb-4 border-t border-sand-200/60 pt-4 space-y-3">
        {order.items.map((item, idx) => (
          <div key={`${item.id}-${idx}`}>
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-extrabold text-text-primary tabular-nums leading-none flex-shrink-0 min-w-[2.5rem]">
                ×{item.quantity}
              </span>
              <span className="text-xl font-semibold text-text-primary leading-tight">
                {item.name || t("bar.item")}
              </span>
            </div>
            {item.notes && (
              <div className="mt-1 ml-[3.25rem] text-sm text-status-warn-700 italic leading-snug">
                ↳ {item.notes}
                {translateToArabic(item.notes) && (
                  <span className="block text-status-warn-800 font-semibold not-italic" dir="rtl">
                    {translateToArabic(item.notes)}
                  </span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Order-wide note — visually distinct warning block */}
      {order.notes && (
        <div className="mx-6 mb-4 px-3 py-2.5 bg-status-warn-100 border-l-4 border-status-warn-500 rounded-r-lg">
          <div className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-widest text-status-warn-800 mb-1">
            <span>⚠</span>{t("bar.notes")}
          </div>
          <div className="text-base font-semibold text-status-warn-900 leading-snug">
            {order.notes}
          </div>
          {translateToArabic(order.notes) && (
            <div className="mt-0.5 text-base text-status-warn-900 font-semibold leading-snug" dir="rtl">
              {translateToArabic(order.notes)}
            </div>
          )}
        </div>
      )}

      {/* Footer reference row — order # · de-emphasized */}
      <div className={`px-6 ${action ? "pb-3" : "pb-4"} text-[11px] font-extrabold uppercase tracking-widest text-text-muted tabular-nums`}>
        #{order.orderNumber}
      </div>

      {/* Full-width action — flush to card edges, sized for tablet thumbs */}
      {action && (
        <button
          onClick={() => onAdvance(order.id)}
          className={`w-full py-4 text-base font-bold transition-all active:scale-[0.99] ${
            order.status === "pending"
              ? "bg-status-warn-500 hover:bg-status-warn-600 text-white"
              : order.status === "preparing"
                ? "bg-status-good-500 hover:bg-status-good-600 text-white"
                : "bg-status-wait-600 hover:bg-status-wait-700 text-white"
          }`}
        >
          {action}
        </button>
      )}
    </motion.div>
  );
}

function ReadyFeed({ orders, now }: { orders: LiveOrder[]; now: number }) {
  const ready = orders
    .filter((o) => o.status === "ready")
    .sort((a, b) => (b.readyAt || b.createdAt) - (a.readyAt || a.createdAt))
    .slice(0, 6);

  const { t } = useLanguage();
  if (ready.length === 0) {
    return <p className="text-xs text-text-muted text-center py-3">{t("bar.noDrinksReady")}</p>;
  }

  return (
    <div className="space-y-1.5">
      {ready.map((order) => {
        const waitedMs = now - (order.readyAt || order.createdAt);
        return (
          <div key={order.id} className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-status-good-50">
            <span className="w-2 h-2 rounded-full bg-status-good-400 animate-pulse flex-shrink-0" />
            <span className="text-sm font-bold text-text-secondary tabular-nums">#{order.orderNumber}</span>
            <span className="text-xs text-text-secondary">{getOrderTag(order)}</span>
            <span className="flex-1" />
            <span className="text-[10px] font-semibold text-text-muted tabular-nums">{fmtWait(waitedMs)}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── BAR MENU AVAILABILITY ───────────────────────
type BarMenuItem = {
  id: string;
  name: string;
  nameAr: string | null;
  price: number;
  image: string | null;
  available: boolean;
  categoryId: string;
};
type BarCategory = {
  id: string;
  name: string;
  nameAr: string | null;
  icon: string | null;
  station: string;
  items: BarMenuItem[];
};

function BarMenuPanel({ staffId }: { staffId?: string }) {
  const { t, lang } = useLanguage();
  const [categories, setCategories] = useState<BarCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const restaurantSlug = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/menu-admin?restaurantId=${restaurantSlug}`);
      if (!res.ok) return;
      const data = await res.json();
      const all: BarCategory[] = data.categories || [];
      setCategories(all.filter((c) => c.station === "BAR"));
    } catch { /* silent */ }
    setLoading(false);
  }, [restaurantSlug]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (item: BarMenuItem) => {
    setToggling((s) => new Set(s).add(item.id));
    try {
      const res = await fetch("/api/menu-admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(staffId ? { "x-staff-id": staffId } : {}) },
        body: JSON.stringify({ id: item.id, available: !item.available }),
      });
      if (res.ok) {
        setCategories((cats) =>
          cats.map((c) => ({
            ...c,
            items: c.items.map((i) =>
              i.id === item.id ? { ...i, available: !i.available } : i
            ),
          }))
        );
      }
    } catch { /* silent */ }
    setToggling((s) => { const n = new Set(s); n.delete(item.id); return n; });
  };

  const allItems = categories.flatMap((c) => c.items.map((i) => ({ ...i, categoryName: lang === "ar" && c.nameAr ? c.nameAr : c.name })));
  const hiddenCount = allItems.filter((i) => !i.available).length;
  const query = search.toLowerCase();
  const filtered = query
    ? allItems.filter((i) => i.name.toLowerCase().includes(query) || i.categoryName.toLowerCase().includes(query))
    : null;

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-12 text-center">
        <div className="w-8 h-8 border-2 border-sand-200 border-t-status-wait-500 rounded-full animate-spin mx-auto" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-semibold text-text-primary">{t("bar.drinkAvailability")}</h2>
          <p className="text-[10px] text-text-secondary">{t("bar.tapToHide")}</p>
        </div>
        {hiddenCount > 0 && (
          <span className="px-2.5 py-1 rounded-full bg-status-bad-100 text-status-bad-600 text-[10px] font-bold">
            {t("bar.hiddenCount").replace("{count}", String(hiddenCount))}
          </span>
        )}
      </div>

      <div className="relative mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("bar.searchDrinks")}
          className="w-full px-4 py-2.5 rounded-xl bg-white border border-sand-200 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-status-wait-300"
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted text-sm font-bold">{"\u2715"}</button>
        )}
      </div>

      {filtered ? (
        <div className="space-y-1.5">
          {filtered.length === 0 && (
            <p className="text-center text-text-muted text-xs py-8">{t("bar.noMatchingDrinks").replace("{query}", search)}</p>
          )}
          {filtered.map((item) => (
            <BarItemRow key={item.id} item={item} toggling={toggling.has(item.id)} onToggle={() => toggle(item)} subtitle={item.categoryName} />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {categories.map((cat) => {
            const isCollapsed = collapsed.has(cat.id);
            const hiddenInCat = cat.items.filter((i) => !i.available).length;
            return (
              <div key={cat.id}>
                <button
                  onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(cat.id)) n.delete(cat.id); else n.add(cat.id); return n; })}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-white border border-sand-200 active:bg-sand-50 transition"
                >
                  {cat.icon && <span className="text-lg">{cat.icon}</span>}
                  <h3 className="text-base font-extrabold text-text-primary flex-1 text-left">{lang === "ar" && cat.nameAr ? cat.nameAr : cat.name}</h3>
                  <span className="text-xs text-text-muted font-semibold">{t("bar.itemCount").replace("{count}", String(cat.items.length))}</span>
                  {hiddenInCat > 0 && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-status-bad-100 text-status-bad-600">
                      {t("bar.offCount").replace("{count}", String(hiddenInCat))}
                    </span>
                  )}
                  <svg className={`w-4 h-4 text-text-muted transition-transform ${isCollapsed ? "" : "rotate-180"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {!isCollapsed && (
                  <div className="space-y-1.5 mt-2">
                    {cat.items.map((item) => (
                      <BarItemRow key={item.id} item={item} toggling={toggling.has(item.id)} onToggle={() => toggle(item)} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BarItemRow({ item, toggling, onToggle, subtitle }: {
  item: BarMenuItem;
  toggling: boolean;
  onToggle: () => void;
  subtitle?: string;
}) {
  const { t, lang } = useLanguage();
  const displayName = lang === "ar" && item.nameAr ? item.nameAr : item.name;
  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${
      item.available
        ? "bg-white border-sand-200"
        : "bg-status-bad-50/60 border-status-bad-200"
    }`}>
      {item.image && (
        <img src={item.image} alt="" className={`w-10 h-10 rounded-lg object-cover flex-shrink-0 ${!item.available ? "grayscale opacity-50" : ""}`} />
      )}
      <div className="flex-1 min-w-0">
        <span className={`text-sm font-bold ${item.available ? "text-text-primary" : "text-status-bad-700 line-through"}`}>{displayName}</span>
        {subtitle && <p className="text-[10px] text-text-muted">{subtitle}</p>}
      </div>
      <button
        onClick={onToggle}
        disabled={toggling}
        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all active:scale-95 disabled:opacity-50 ${
          item.available
            ? "bg-status-good-100 text-status-good-700 hover:bg-status-good-200"
            : "bg-status-bad-100 text-status-bad-700 hover:bg-status-bad-200"
        }`}
      >
        {toggling ? "..." : item.available ? t("bar.available") : t("bar.hidden")}
      </button>
    </div>
  );
}

function BarSystem({ staff }: { staff: StaffInfo }) {
  const { lang, toggleLang, t, dir } = useLanguage();
  const [activeTab, setActiveTab] = useState<"orders" | "menu">("orders");
  // Shift awareness — same pattern as cashier and kitchen.
  const [shiftInfo, setShiftInfo] = useState(() => getShiftTimer(staff.shift, staff.role));
  useEffect(() => {
    const tick = () => {
      const next = getShiftTimer(staff.shift, staff.role);
      setShiftInfo((prev) =>
        prev.label === next.label && prev.isOnShift === next.isOnShift ? prev : next
      );
    };
    tick();
    const id = setInterval(tick, 60000);
    // Re-check shift immediately when tab regains focus (covers idle/sleep gaps)
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [staff.shift, staff.role]);
  const isOnShift = staff.shift === 0 || shiftInfo.isOnShift;

  const allOrders = usePerception((s) => s.orders);
  const bar = usePerception((s) => s.bar);
  const updateOrder = usePerception((s) => s.updateOrder);

  const orders = useMemo(
    () => allOrders.filter((o) => o.station === "BAR"),
    [allOrders]
  );

  const [mounted, setMounted] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [now, setNow] = useState(0);
  const [showSchedule, setShowSchedule] = useState(false);

  useLiveData(staff.id);

  useEffect(() => {
    useMenu.getState().initialize();
  }, []);

  useEffect(() => {
    setMounted(true);
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const activeOrders = useMemo(
    () => orders.filter((o) => ["pending", "confirmed", "preparing"].includes(o.status)),
    [orders]
  );

  const sortedQueue = useMemo(() => {
    if (!now) return [];
    return activeOrders
      .map((order) => ({ order, priority: computePriority(order, now) }))
      .sort((a, b) => b.priority.score - a.priority.score);
  }, [activeOrders, now]);

  const advanceOrder = useCallback(
    (orderId: string) => {
      const order = allOrders.find((o) => o.id === orderId);
      if (!order) return;

      const flow: Record<string, LiveOrder["status"]> = {
        pending: "confirmed",
        confirmed: "preparing",
        preparing: "ready",
        ready: "served",
      };
      const next = flow[order.status];
      if (!next) return;

      const update: Partial<LiveOrder> = { status: next };
      if (next === "preparing") update.prepStartedAt = Date.now();
      if (next === "ready") { update.readyAt = Date.now(); update.isDelayed = false; }
      if (next === "served") update.servedAt = Date.now();

      updateOrder(orderId, update);

      const apiStatus = next.toUpperCase();
      staffFetch(staff.id, `/api/orders/${orderId}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          status: apiStatus,
          restaurantId: useMenu.getState().restaurantId || "demo",
          staffId: staff.id,
        }),
      }).catch((err) => console.error("Failed to update order status:", err));
    },
    [allOrders, updateOrder]
  );

  const pendingC = activeOrders.filter((o) => o.status === "pending").length;
  const preparingC = activeOrders.filter((o) => o.status === "preparing").length;
  const readyC = orders.filter((o) => o.status === "ready").length;
  const delayedC = activeOrders.filter((o) => o.isDelayed).length;
  const capacity = bar.capacity || 0;
  const avgWait = activeOrders.length > 0 && now
    ? Math.round(activeOrders.reduce((s, o) => s + (now - o.createdAt) / 60000, 0) / activeOrders.length)
    : 0;

  const loadLevel = capacity >= 85 ? t("bar.load.critical") : capacity >= 60 ? t("bar.load.heavy") : capacity >= 30 ? t("bar.load.normal") : t("bar.load.light");
  const loadColor =
    capacity >= 85 ? "text-status-bad-600" : capacity >= 60 ? "text-status-warn-600" : "text-status-good-600";

  if (!mounted) {
    return (
      <div className="min-h-dvh bg-sand-50 flex items-center justify-center">
        <div className="text-text-muted text-sm font-medium">{t("bar.loadingBar")}</div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-sand-50">
      {/* ═══ OFF-SHIFT OVERLAY ═══ */}
      {!isOnShift && staff.shift !== 0 && (
        <div className="fixed inset-0 z-50 bg-sand-900/80 flex items-center justify-center px-4">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl">
            <div className="w-16 h-16 rounded-2xl bg-status-bad-100 flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">🕐</span>
            </div>
            <h2 className="text-xl font-semibold text-text-primary mb-2">{t("bar.offShift")}</h2>
            <p className="text-sm text-text-secondary mb-1">{getShiftLabel(staff.shift, staff.role)}</p>
            <p className="text-lg font-bold text-status-bad-600 mb-4">{shiftInfo.label}</p>
            <p className="text-xs text-text-muted mb-6">{t("bar.offShiftMessage")}</p>
            <LogoutButton role="bar" className="w-full justify-center py-3 rounded-xl bg-sand-900 text-white font-bold text-sm" />
          </div>
        </div>
      )}

      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b border-sand-200">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 py-2.5 sm:py-3">
          {/* Title row — name + badges on the left, utility cluster on the right.
              Below sm, Schedule + Language + Logout collapse into a kebab. */}
          <div className="flex items-center gap-2 mb-3">
            <div className="min-w-0 flex-1 flex items-center gap-2">
              <div className="min-w-0">
                <h1 className="text-sm sm:text-lg font-semibold text-text-primary tracking-tight flex items-center gap-1.5 truncate">
                  <span className="truncate">{staff.name}</span>
                  <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider px-1.5 sm:px-2 py-0.5 rounded-lg bg-status-wait-100 text-status-wait-600 flex-shrink-0">{t("bar.badge")}</span>
                  <span className={`w-2 h-2 rounded-full ${isOnShift ? "bg-status-good-500" : "bg-status-bad-500"} animate-pulse flex-shrink-0`} />
                </h1>
                <p className="hidden sm:block text-[10px] text-text-secondary font-semibold mt-0.5 truncate">{t("bar.drinkStation")}</p>
              </div>
              <span className={`hidden sm:inline-flex text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full flex-shrink-0 ${
                capacity >= 85 ? "bg-status-bad-100 text-status-bad-600"
                : capacity >= 60 ? "bg-status-warn-100 text-status-warn-600"
                : "bg-status-good-100 text-status-good-600"
              }`}>
                {loadLevel}
              </span>
            </div>
            <ClockButton staffId={staff.id} name={staff.name} role={staff.role} />
            {/* Desktop: inline history + schedule + language + logout */}
            <div className="hidden sm:flex items-center gap-2">
              <button onClick={() => setShowHistory(true)} className="p-2 hover:bg-sand-100 rounded-xl transition" title="Order history">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><polyline points="3 3 3 8 8 8"/><polyline points="12 7 12 12 15 14"/></svg>
              </button>
              <button onClick={() => setShowSchedule(true)} className="p-2 hover:bg-sand-100 rounded-xl transition" title={t("bar.mySchedule")}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </button>
              <LanguageToggle lang={lang} onToggle={toggleLang} />
              <LogoutButton role="bar" />
            </div>
            <StaffHeaderMenu
              lang={lang}
              onToggleLang={toggleLang}
              onOpenSchedule={() => setShowSchedule(true)}
              logoutRole="bar"
              scheduleLabel={t("bar.mySchedule")}
            />
          </div>

          {staff.shift !== 0 && (
            <div className={`flex items-center justify-between px-3 py-2 rounded-xl mb-3 ${
              isOnShift ? "bg-status-good-50 border border-status-good-200" : "bg-status-bad-50 border border-status-bad-200"
            }`}>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${isOnShift ? "bg-status-good-500" : "bg-status-bad-500"} animate-pulse`} />
                <span className={`text-xs font-bold ${isOnShift ? "text-status-good-700" : "text-status-bad-700"}`}>
                  {getShiftLabel(staff.shift, staff.role)}
                </span>
              </div>
              <span className={`text-sm font-semibold tabular-nums ${isOnShift ? "text-status-good-800" : "text-status-bad-800"}`}>
                {shiftInfo.label}
              </span>
            </div>
          )}

          <div className="grid grid-cols-5 gap-1.5 sm:gap-4">
            {[
              { label: t("bar.queue"), value: activeOrders.length, color: activeOrders.length >= 6 ? "text-status-bad-600" : "text-text-primary" },
              { label: t("bar.pending"), value: pendingC, color: pendingC > 0 ? "text-status-warn-600" : "text-text-muted" },
              { label: t("bar.pouring"), value: preparingC, color: "text-status-wait-600" },
              { label: t("bar.ready"), value: readyC, color: readyC > 0 ? "text-status-good-600" : "text-text-muted" },
              { label: t("bar.avgWait"), value: `${avgWait}m`, color: avgWait > 8 ? "text-status-bad-600" : "text-text-secondary" },
            ].map((kpi) => (
              <div key={kpi.label} className="text-center min-w-0">
                <div className={`text-base sm:text-xl font-semibold tabular-nums ${kpi.color}`}>{kpi.value}</div>
                <div className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-wider text-text-muted truncate">{kpi.label}</div>
              </div>
            ))}
          </div>
          {/* Tab bar */}
          <div className="flex gap-1 mt-3">
            {(["orders", "menu"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                  activeTab === tab
                    ? "bg-status-wait-600 text-white"
                    : "bg-sand-100 text-text-secondary"
                }`}
              >
                {tab === "orders" ? t("bar.orders") : t("bar.drinkMenu")}
              </button>
            ))}
          </div>
        </div>
      </header>
      {showSchedule && <SchedulePopup staffId={staff.id} role={staff.role} onClose={() => setShowSchedule(false)} />}
      {showHistory && <OrderHistoryDrawer orders={orders} role="bar" onClose={() => setShowHistory(false)} />}

      {activeTab === "menu" ? (
        <BarMenuPanel staffId={staff.id} />
      ) : (
      <div className="max-w-6xl mx-auto px-4 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
          {/* Left: Queue */}
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {sortedQueue.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center py-20"
                >
                  <p className="text-text-muted text-sm font-medium">{t("bar.noActiveDrinkOrders")}</p>
                </motion.div>
              ) : (
                sortedQueue.map(({ order, priority }) => (
                  <OrderCard
                    key={order.id}
                    order={order}
                    priority={priority}
                    now={now}
                    onAdvance={advanceOrder}
                  />
                ))
              )}
            </AnimatePresence>
          </div>

          {/* Right sidebar */}
          <div className="space-y-4">
            <div className="bg-white rounded-xl border border-sand-200 p-4 shadow-sm">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-2">
                {t("bar.capacity")}
              </h3>
              <div className="flex items-baseline gap-2">
                <span className={`text-3xl font-semibold tabular-nums ${loadColor}`}>{capacity}%</span>
                <span className="text-xs text-text-muted">{t("bar.ordersCount").replace("{count}", String(activeOrders.length))}</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-sand-100 overflow-hidden">
                <motion.div
                  className={`h-full rounded-full ${
                    capacity >= 85 ? "bg-status-bad-500" : capacity >= 60 ? "bg-status-warn-400" : "bg-status-good-400"
                  }`}
                  animate={{ width: `${Math.min(100, capacity)}%` }}
                  transition={{ duration: 0.4 }}
                />
              </div>
            </div>

            <div className="bg-white rounded-xl border border-sand-200 p-4 shadow-sm">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-2">
                {t("bar.readyForPickup")}
              </h3>
              <ReadyFeed orders={orders} now={now} />
            </div>

            <div className="bg-white rounded-xl border border-sand-200 p-4 shadow-sm">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-2">
                {t("bar.stats")}
              </h3>
              <div className="space-y-2.5">
                {[
                  { label: t("bar.avgPrep"), value: `${bar.avgPrepTime}m` },
                  { label: t("bar.totalToday"), value: orders.length },
                  { label: t("bar.delayed"), value: delayedC > 0 ? delayedC : t("bar.none"), color: delayedC > 0 ? "text-status-bad-500" : "text-status-good-500" },
                ].map((row) => (
                  <div key={row.label} className="flex items-center justify-between text-xs">
                    <span className="text-text-secondary">{row.label}</span>
                    <span className={`font-bold tabular-nums ${row.color || "text-text-secondary"}`}>{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      )}
    </div>
  );
}

function BarLogin({ onLogin }: { onLogin: (staff: { id: string; name: string; role: string; shift: number }) => void }) {
  const { t } = useLanguage();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const restaurantSlug = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";

  const handleSubmit = async () => {
    if (pin.length < 4) {
      setError(t("login.pinTooShort"));
      return;
    }
    setError("");
    setLoading(true);
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
      if (staff.role !== "BAR") {
        setError(t("bar.notBarPin"));
        setLoading(false);
        return;
      }
      onLogin(staff);
    } catch {
      setError(t("login.networkError"));
    }
    setLoading(false);
  };

  return (
    <div className="min-h-dvh bg-sand-900 flex items-center justify-center px-4">
      <motion.div
        className="w-full max-w-sm bg-sand-800 rounded-3xl shadow-xl p-8 border border-sand-700"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-status-wait-600 flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">🍹</span>
          </div>
          <h1 className="text-xl font-semibold text-white">{t("bar.login")}</h1>
          <p className="text-sm text-text-muted mt-1">{t("bar.loginDesc")}</p>
        </div>

        <div className="flex justify-center gap-3 mb-6">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className={`w-12 h-14 rounded-xl border-2 flex items-center justify-center text-xl font-semibold transition-all ${
                pin.length > i
                  ? "border-status-wait-500 bg-status-wait-900/30 text-status-wait-400"
                  : "border-sand-600 bg-sand-700 text-transparent"
              }`}
            >
              {pin.length > i ? "●" : "○"}
            </div>
          ))}
        </div>

        {error && (
          <motion.p
            className="text-center text-status-bad-400 text-sm font-semibold mb-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            {error}
          </motion.p>
        )}

        <div className="grid grid-cols-3 gap-2 mb-6">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].map((key) => (
            <button
              key={key || "empty"}
              onClick={() => {
                if (key === "⌫") setPin((p) => p.slice(0, -1));
                else if (key && pin.length < 6) {
                  setPin((p) => p + key);
                  setError("");
                }
              }}
              disabled={!key}
              className={`h-14 rounded-xl text-xl font-bold transition-all active:scale-95 ${
                key === "⌫"
                  ? "bg-sand-700 text-text-muted"
                  : key
                    ? "bg-sand-700 text-white hover:bg-sand-600"
                    : "invisible"
              }`}
            >
              {key}
            </button>
          ))}
        </div>

        <button
          onClick={handleSubmit}
          disabled={pin.length < 4 || loading}
          className={`w-full py-4 rounded-2xl text-lg font-bold transition-all ${
            pin.length >= 4 && !loading
              ? "bg-status-wait-600 text-white hover:bg-status-wait-700"
              : "bg-sand-700 text-text-secondary cursor-not-allowed"
          }`}
        >
          {loading ? t("login.verifying") : t("bar.openBar")}
        </button>
      </motion.div>
    </div>
  );
}

export default function BarPage() {
  const [staff, setStaff] = useState<StaffInfo | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("bar_staff");
      if (saved) {
        const parsed = JSON.parse(saved);
        const loginAt = parsed.loginAt || 0;
        if (Date.now() - loginAt < 16 * 60 * 60 * 1000) {
          setStaff({ id: parsed.id, name: parsed.name, role: parsed.role, shift: parsed.shift });
        } else {
          localStorage.removeItem("bar_staff");
        }
      }
    } catch {
      /* silent */
    }
    setHydrated(true);
  }, []);

  const handleLogin = useCallback(
    (s: StaffInfo) => {
      localStorage.setItem("bar_staff", JSON.stringify({ ...s, loginAt: Date.now() }));
      setStaff(s);
      import("@/lib/notifications").then(({ requestNotificationPermission }) => {
        requestNotificationPermission();
      });
      import("@/lib/push-client").then(({ subscribeToPush }) => {
        const restaurantSlug = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";
        subscribeToPush(s.id, "BAR", restaurantSlug).catch(() => {});
      });
    },
    []
  );

  if (!hydrated) {
    return (
      <div className="min-h-dvh bg-sand-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-sand-200 border-t-status-wait-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!staff) {
    return <BarLogin onLogin={handleLogin} />;
  }

  return <BarSystem staff={staff} />;
}
