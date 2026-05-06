"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePerception, type LiveOrder } from "@/lib/engine/perception";
import { useLiveData } from "@/lib/use-live-data";
import { useMenu } from "@/store/menu";
import { useLanguage } from "@/lib/use-language";
import { localizedMessageText } from "@/lib/localize-message";
import { LanguageToggle } from "@/presentation/components/ui/LanguageToggle";
import LogoutButton from "@/presentation/components/ui/LogoutButton";
import type { Lang } from "@/i18n";
import { DEFAULT_KITCHEN_CONFIG, computeKitchenCapacity, normalizeKitchenConfig, type KitchenConfig } from "@/lib/kitchen-config";
import { getShiftTimer, getShiftLabel } from "@/lib/shifts";
import SchedulePopup from "@/presentation/components/ui/SchedulePopup";
import { OrderHistoryDrawer } from "@/presentation/components/ui/OrderHistoryDrawer";
import { ClockButton } from "@/presentation/components/ui/ClockButton";
import { StaffHeaderMenu } from "@/presentation/components/ui/StaffHeaderMenu";
import { translateToArabic } from "@/lib/translate-notes";
import { getOrderTag } from "@/lib/order-label";
import { staffFetch } from "@/lib/staff-fetch";
import { startPoll } from "@/lib/polling";

type StaffInfo = { id: string; name: string; role: string; shift: number };

// ═══════════════════════════════════════════════════════
// KITCHEN PRODUCTION MANAGEMENT SYSTEM
// ═══════════════════════════════════════════════════════

// ─── PREP STATION MAPPING ────────────────────────────

type Station = "grill" | "fryer" | "bar" | "dessert" | "cold" | "pasta";

const ITEM_STATION: Record<string, Station> = {
  s1: "cold", s2: "grill", s3: "fryer",
  m1: "grill", m2: "grill", m3: "pasta", m4: "grill",
  d1: "bar", d2: "bar", d3: "bar", d4: "bar", d5: "bar",
  ds1: "dessert", ds2: "dessert",
};

const STATION_KEY: Record<Station, string> = {
  grill: "kitchen.station.grill", fryer: "kitchen.station.fryer", bar: "kitchen.station.bar", dessert: "kitchen.station.dessert", cold: "kitchen.station.cold", pasta: "kitchen.station.pasta",
};

function getStation(itemId: string): Station {
  return ITEM_STATION[itemId] || "cold";
}

function getPrepTime(itemId: string): number {
  return useMenu.getState().allItems.find((i) => i.id === itemId)?.prepTime || 10;
}

// ─── PRIORITY ENGINE ─────────────────────────────────

type PriorityLevel = "critical" | "high" | "normal" | "low";

function computePriority(order: LiveOrder, now: number): {
  level: PriorityLevel;
  score: number;
} {
  const waitMin = (now - order.createdAt) / 60000;
  let score = 0;

  if (waitMin > 25) score += 100;
  else if (waitMin > 15) score += 60;
  else if (waitMin > 8) score += 30;
  else score += Math.round(waitMin * 2);

  const maxPrep = Math.max(...order.items.map((i) => getPrepTime(i.id)));
  if (maxPrep <= 3) score += 15;

  if (order.total > 400) score += 8;
  if (order.isDelayed) score += 50;
  if (order.status === "pending") score += 20;
  if (order.status === "confirmed") score += 10;

  const level: PriorityLevel =
    score >= 80 ? "critical" : score >= 45 ? "high" : score < 15 ? "low" : "normal";

  return { level, score };
}

// ─── STATION LOAD ANALYSIS ───────────────────────────

type StationLoad = {
  station: Station;
  label: string;
  active: number;
  capacity: number;
  pct: number;
  overloaded: boolean;
};

function analyzeLoads(activeOrders: LiveOrder[], config: KitchenConfig): StationLoad[] {
  const counts: Record<Station, number> = {
    grill: 0, fryer: 0, bar: 0, dessert: 0, cold: 0, pasta: 0,
  };

  for (const order of activeOrders) {
    for (const item of order.items) {
      counts[getStation(item.id)] += item.quantity;
    }
  }

  return (Object.keys(counts) as Station[]).map((s) => {
    const cap = config.stationCaps[s];
    return {
      station: s,
      label: STATION_KEY[s],
      active: counts[s],
      capacity: cap,
      pct: Math.min(100, Math.round((counts[s] / cap) * 100)),
      overloaded: counts[s] > cap,
    };
  });
}

// ─── ALERT DETECTION ─────────────────────────────────

type KitchenAlert = {
  id: string;
  severity: "critical" | "warning";
  message: string;
};

function detectAlerts(loads: StationLoad[], orders: LiveOrder[], now: number, config: KitchenConfig): KitchenAlert[] {
  const alerts: KitchenAlert[] = [];

  for (const l of loads) {
    if (l.overloaded) {
      alerts.push({
        id: `over-${l.station}`,
        severity: "critical",
        message: `kitchen.alert.overloaded::${l.label}::${l.active}::${l.capacity}`,
      });
    }
  }

  const stuckPending = orders.filter(
    (o) => o.status === "pending" && (now - o.createdAt) / 60000 > 5
  );
  if (stuckPending.length > 0) {
    alerts.push({
      id: "stuck-pending",
      severity: "critical",
      message: `kitchen.alert.stuckPending::${stuckPending.length}`,
    });
  }

  const delayed = orders.filter((o) => o.isDelayed);
  if (delayed.length > 0) {
    alerts.push({
      id: "delayed",
      severity: "warning",
      message: `kitchen.alert.delayed::${delayed.length}`,
    });
  }

  const total = orders.filter((o) =>
    ["pending", "confirmed", "preparing"].includes(o.status)
  ).length;
  if (total >= config.maxParallel) {
    alerts.push({ id: "full", severity: "critical", message: "kitchen.kitchenAtMax" });
  }

  return alerts;
}

// ─── TIME HELPERS ────────────────────────────────────

function fmtWait(ms: number): string {
  const min = Math.round(ms / 60000);
  return `${min}m`;
}

// ═══════════════════════════════════════════════════════
// COMPONENTS
// ═══════════════════════════════════════════════════════

const PRIORITY_DOT: Record<PriorityLevel, string> = {
  critical: "bg-status-bad-500",
  high: "bg-status-warn-500",
  normal: "bg-sand-300",
  low: "bg-sand-200",
};

const STATUS_PILL: Record<string, { bg: string; text: string }> = {
  pending: { bg: "bg-status-warn-100", text: "text-status-warn-700" },
  confirmed: { bg: "bg-status-info-100", text: "text-status-info-700" },
  preparing: { bg: "bg-status-wait-100", text: "text-status-wait-700" },
  ready: { bg: "bg-status-good-100", text: "text-status-good-700" },
  served: { bg: "bg-sand-100", text: "text-text-secondary" },
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

// ─── ORDER CARD ──────────────────────────────────────

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
  const { t } = useLanguage();
  const waitMs = now - order.createdAt;
  const waitMin = Math.round(waitMs / 60000);
  const stations = [...new Set(order.items.map((i) => getStation(i.id)))];

  const nextLabel: Record<string, string> = {
    pending: t("kitchen.accept"),
    confirmed: t("kitchen.startPrep"),
    preparing: t("kitchen.ready"),
    ready: t("kitchen.served"),
  };
  const action = nextLabel[order.status];

  const handleAdvance = () => {
    onAdvance(order.id);
  };

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
      {/* Header — table is the hero (cooks route by table, not order #) */}
      <div className="px-6 pt-5 pb-4">
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-text-muted mb-1">
              {t("kitchen.deliverTo")}
            </div>
            <div className="text-4xl font-extrabold text-text-primary leading-none tracking-tight truncate">
              {getOrderTag(order)}
            </div>
          </div>

          <div className="text-right flex-shrink-0">
            <div className="text-[10px] font-extrabold uppercase tracking-[0.15em] text-text-muted mb-1">
              {t("kitchen.waiting")}
            </div>
            <div className={`text-3xl font-extrabold tabular-nums leading-none tracking-tight ${
              waitMin > 15 ? "text-status-bad-600"
              : waitMin > 8 ? "text-status-warn-600"
              : "text-text-secondary"
            }`}>
              {fmtWait(waitMs)}
            </div>
          </div>
        </div>

        {order.isDelayed && (
          <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-status-bad-500 text-white text-[10px] font-extrabold uppercase tracking-widest animate-pulse">
            <span>⚠</span>
            {t("kitchen.delayed.badge")}
          </div>
        )}
      </div>

      {/* Items — quantity prefix + name on a single baseline, scannable like a recipe */}
      <div className="px-6 pb-4 border-t border-sand-200/60 pt-4 space-y-3">
        {order.items.map((item, idx) => (
          <div key={`${item.id}-${idx}`}>
            <div className="flex items-baseline gap-3">
              <span className="text-2xl font-extrabold text-text-primary tabular-nums leading-none flex-shrink-0 min-w-[2.5rem]">
                ×{item.quantity}
              </span>
              <span className="text-xl font-semibold text-text-primary leading-tight">
                {item.name || t("kitchen.itemFallback")}
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
            <span>⚠</span>{t("kitchen.notes")}
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

      {/* Footer reference row — order # + stations · de-emphasized */}
      <div className={`px-6 ${action ? "pb-3" : "pb-4"} flex items-center justify-between gap-3 text-[11px] font-extrabold uppercase tracking-widest text-text-muted`}>
        <span className="tabular-nums">#{order.orderNumber}</span>
        {stations.length > 0 && (
          <div className="flex gap-2.5">
            {stations.map((s) => (
              <span key={s}>{t("kitchen.station." + s)}</span>
            ))}
          </div>
        )}
      </div>

      {/* Full-width action — flush to card edges, sized for tablet thumbs */}
      {action && (
        <button
          onClick={handleAdvance}
          className={`w-full py-4 text-base font-bold transition-all active:scale-[0.99] ${
            order.status === "pending"
              ? "bg-status-warn-500 hover:bg-status-warn-600 text-white"
              : order.status === "preparing"
                ? "bg-status-good-500 hover:bg-status-good-600 text-white"
                : "bg-sand-800 hover:bg-sand-900 text-white"
          }`}
        >
          {action}
        </button>
      )}
    </motion.div>
  );
}

// ─── STATION LOAD BAR ────────────────────────────────

function LoadBar({ load }: { load: StationLoad }) {
  const { t } = useLanguage();
  const barColor =
    load.pct >= 100 ? "bg-status-bad-500"
    : load.pct >= 75 ? "bg-status-warn-400"
    : load.pct >= 40 ? "bg-status-info-400"
    : "bg-status-good-400";

  return (
    <div className="flex items-center gap-2.5 py-1.5">
      <span className="text-xs font-semibold text-text-secondary w-14">{t("kitchen.station." + load.station)}</span>
      <div className="flex-1 h-2 rounded-full bg-sand-100 overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${barColor}`}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, load.pct)}%` }}
          transition={{ duration: 0.4 }}
        />
      </div>
      <span className={`text-[11px] font-bold tabular-nums w-9 text-right ${load.overloaded ? "text-status-bad-500" : "text-text-muted"}`}>
        {load.active}/{load.capacity}
      </span>
    </div>
  );
}

// ─── READY FEED ──────────────────────────────────────

function ReadyFeed({ orders, now, onAdvance }: { orders: LiveOrder[]; now: number; onAdvance: (id: string) => void }) {
  const { t } = useLanguage();
  const ready = orders
    .filter((o) => o.status === "ready")
    .sort((a, b) => (b.readyAt || b.createdAt) - (a.readyAt || a.createdAt))
    .slice(0, 6);

  if (ready.length === 0) {
    return <p className="text-xs text-text-muted text-center py-3">{t("kitchen.noOrdersReady")}</p>;
  }

  return (
    <div className="space-y-1.5">
      {ready.map((order) => (
        <div key={order.id} className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-status-good-50">
          <span className="w-2 h-2 rounded-full bg-status-good-400 animate-pulse flex-shrink-0" />
          <span className="text-sm font-bold text-text-secondary tabular-nums">#{order.orderNumber}</span>
          <span className="text-xs text-text-secondary">{getOrderTag(order)}</span>
          <span className="flex-1" />
          {/* "Out" tap = the dish has left the pickup window. Flips
              the order to SERVED. Used when the floor is running
              without phones — kitchen owns the SERVED transition. */}
          <button
            onClick={() => onAdvance(order.id)}
            className="px-3 py-1 rounded-lg bg-status-good-600 hover:bg-status-good-700 active:scale-95 text-white text-[11px] font-extrabold uppercase tracking-wider transition"
          >
            {t("kitchen.markOut")}
          </button>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// MAIN: KITCHEN SYSTEM
// ═══════════════════════════════════════════════════════

// ─── MENU AVAILABILITY PANEL ─────────────────────
type KitchenMenuItem = {
  id: string;
  name: string;
  nameAr: string | null;
  price: number;
  image: string | null;
  available: boolean;
  categoryId: string;
};
type KitchenCategory = {
  id: string;
  name: string;
  nameAr: string | null;
  icon: string | null;
  items: KitchenMenuItem[];
};

function MenuAvailabilityPanel({ staffId }: { staffId?: string }) {
  const { t, lang } = useLanguage();
  const [categories, setCategories] = useState<KitchenCategory[]>([]);
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
      setCategories(data.categories || []);
    } catch { /* silent */ }
    setLoading(false);
  }, [restaurantSlug]);

  useEffect(() => { load(); }, [load]);

  const toggle = async (item: KitchenMenuItem) => {
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
        <div className="w-8 h-8 border-2 border-sand-200 border-t-status-warn-500 rounded-full animate-spin mx-auto" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-base font-semibold text-text-primary">{t("kitchen.menuAvailability")}</h2>
          <p className="text-[10px] text-text-secondary">{t("kitchen.menuAvailabilityDesc")}</p>
        </div>
        {hiddenCount > 0 && (
          <span className="px-2.5 py-1 rounded-full bg-status-bad-100 text-status-bad-600 text-[10px] font-bold">
            {t("kitchen.hiddenCount").replace("{count}", String(hiddenCount))}
          </span>
        )}
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("kitchen.searchItems")}
          className="w-full px-4 py-2.5 rounded-xl bg-white border border-sand-200 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-status-warn-300"
        />
        {search && (
          <button onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted text-sm font-bold">✕</button>
        )}
      </div>

      {/* Search results */}
      {filtered ? (
        <div className="space-y-1.5">
          {filtered.length === 0 && (
            <p className="text-center text-text-muted text-xs py-8">{t("kitchen.noItemsMatching").replace("{query}", search)}</p>
          )}
          {filtered.map((item) => (
            <MenuItemRow key={item.id} item={item} toggling={toggling.has(item.id)} onToggle={() => toggle(item)} subtitle={item.categoryName} />
          ))}
        </div>
      ) : (
        /* Category groups — collapsible */
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
                  <span className="text-xs text-text-muted font-semibold">{t("kitchen.itemCount").replace("{count}", String(cat.items.length))}</span>
                  {hiddenInCat > 0 && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-status-bad-100 text-status-bad-600">
                      {t("kitchen.offCount").replace("{count}", String(hiddenInCat))}
                    </span>
                  )}
                  <svg className={`w-4 h-4 text-text-muted transition-transform ${isCollapsed ? "" : "rotate-180"}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {!isCollapsed && (
                  <div className="space-y-1.5 mt-2">
                    {cat.items.map((item) => (
                      <MenuItemRow key={item.id} item={item} toggling={toggling.has(item.id)} onToggle={() => toggle(item)} />
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

function MenuItemRow({ item, toggling, onToggle, subtitle }: {
  item: KitchenMenuItem;
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
        {toggling ? "..." : item.available ? t("kitchen.available") : t("kitchen.hidden")}
      </button>
    </div>
  );
}

function KitchenSystem({ staff }: { staff: StaffInfo }) {
  const { lang, toggleLang, t, dir } = useLanguage();

  // Shift awareness — matches cashier's pattern. Ticker runs at 60s
  // because the label is minute-resolution ("2h 14m remaining"), and
  // we bail out of setState on unchanged ticks so a no-op minute doesn't
  // rerender the kitchen grid. After shift + grace period, a blocking
  // overlay prevents all actions. The server also rejects status updates
  // from off-shift staff as a second layer of enforcement.
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
  // Kitchen only sees its own station. Drink-only orders and the bar
  // half of mixed-cart splits live on /bar.
  const orders = useMemo(
    () => allOrders.filter((o) => (o.station ?? "KITCHEN") === "KITCHEN"),
    [allOrders]
  );
  const kitchen = usePerception((s) => s.kitchen);
  const updateOrder = usePerception((s) => s.updateOrder);

  const [mounted, setMounted] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [now, setNow] = useState(0);
  const [kitchenConfig, setKitchenConfigState] = useState<KitchenConfig>(DEFAULT_KITCHEN_CONFIG);
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());
  const [ownerMessages, setOwnerMessages] = useState<{ id: string; type: string; text?: string; audio?: string; command?: string | null; tableId?: number | null; orderId?: string | null; createdAt: number }[]>([]);
  const [dismissedMessages, setDismissedMessages] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<"orders" | "menu">("orders");
  const lastMsgPoll = useRef(Date.now());
  const playedVoiceNotes = useRef(new Set<string>());

  // Live data hook — polls /api/live-snapshot
  useLiveData(staff.id);

  // Initialize menu store
  useEffect(() => { useMenu.getState().initialize(); }, []);

  // Fetch per-restaurant kitchen config
  useEffect(() => {
    const slug = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";
    fetch(`/api/restaurant/kitchen-config?restaurantId=${slug}`)
      .then((res) => res.json())
      .then((data) => setKitchenConfigState(normalizeKitchenConfig(data)))
      .catch(() => {});
  }, []);

  // Hydration-safe: only render dynamic content after mount
  useEffect(() => {
    setMounted(true);
    setNow(Date.now());
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(clock);
    };
  }, []);

  // Poll for owner messages to kitchen
  useEffect(() => {
    const restaurantSlug = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";
    return startPoll(() => {
      fetch(`/api/messages?since=${lastMsgPoll.current}&to=kitchen&restaurantId=${restaurantSlug}`)
        .then((res) => res.json())
        .then((msgs: { id: string; type: string; text?: string; audio?: string; createdAt: number }[]) => {
          if (msgs.length > 0) {
            setOwnerMessages((prev) => {
              const existingIds = new Set(prev.map((m) => m.id));
              const newMsgs = msgs.filter((m) => !existingIds.has(m.id));
              return newMsgs.length > 0 ? [...prev, ...newMsgs] : prev;
            });
            lastMsgPoll.current = Math.max(...msgs.map((m) => m.createdAt));
            // Auto-play voice notes
            for (const msg of msgs) {
              if (msg.type === "voice" && msg.audio && !playedVoiceNotes.current.has(msg.id)) {
                playedVoiceNotes.current.add(msg.id);
                const audio = new Audio(msg.audio);
                audio.play().catch(() => {});
              }
            }
          }
        })
        .catch(() => {});
    }, 4000);
  }, []);

  const visibleOwnerMessages = ownerMessages.filter((m) => !dismissedMessages.has(m.id));

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

  const stationLoads = useMemo(() => analyzeLoads(activeOrders, kitchenConfig), [activeOrders, kitchenConfig]);

  const alerts = useMemo(() => {
    if (!now) return [];
    return detectAlerts(stationLoads, activeOrders, now, kitchenConfig).filter(
      (a) => !dismissedAlerts.has(a.id)
    );
  }, [stationLoads, activeOrders, now, dismissedAlerts, kitchenConfig]);

  const advanceOrder = useCallback(
    (orderId: string) => {
      const order = orders.find((o) => o.id === orderId);
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

      // Update local state immediately for instant feedback
      updateOrder(orderId, update);

      // Broadcast via API so other tabs/pages see the change
      const apiStatus = next.toUpperCase();
      staffFetch(staff.id, `/api/orders/${orderId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: apiStatus, restaurantId: useMenu.getState().restaurantId || "demo", staffId: staff.id }),
      }).catch((err) => console.error("Failed to update order status:", err));
    },
    [orders, updateOrder]
  );

  // Stats
  const pendingC = activeOrders.filter((o) => o.status === "pending").length;
  const preparingC = activeOrders.filter((o) => o.status === "preparing").length;
  const readyC = orders.filter((o) => o.status === "ready").length;
  const delayedC = activeOrders.filter((o) => o.isDelayed).length;
  const capacity = computeKitchenCapacity(activeOrders.length, kitchenConfig);
  const avgWait = activeOrders.length > 0 && now
    ? Math.round(activeOrders.reduce((s, o) => s + (now - o.createdAt) / 60000, 0) / activeOrders.length)
    : 0;

  const { warn, critical } = kitchenConfig.thresholds;
  const loadLevel = capacity >= critical ? t("kitchen.load.critical") : capacity >= warn ? t("kitchen.load.heavy") : capacity >= warn / 2 ? t("kitchen.load.normal") : t("kitchen.load.light");
  const loadColor =
    capacity >= critical ? "text-status-bad-600" : capacity >= warn ? "text-status-warn-600" : "text-status-good-600";

  // Don't render dynamic content until mounted (prevents hydration mismatch)
  if (!mounted) {
    return (
      <div className="min-h-dvh bg-sand-50 flex items-center justify-center">
        <div className="text-text-muted text-sm font-medium">{t("kitchen.loadingKitchen")}</div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-sand-50" dir={dir}>
      {/* ═══ OFF-SHIFT OVERLAY ═══ */}
      {!isOnShift && staff.shift !== 0 && (
        <div className="fixed inset-0 z-50 bg-sand-900/80 flex items-center justify-center px-4">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl">
            <div className="w-16 h-16 rounded-2xl bg-status-bad-100 flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">🕐</span>
            </div>
            <h2 className="text-xl font-semibold text-text-primary mb-2">{t("kitchen.offShift")}</h2>
            <p className="text-sm text-text-secondary mb-1">{getShiftLabel(staff.shift, staff.role)}</p>
            <p className="text-lg font-bold text-status-bad-600 mb-4">{shiftInfo.label}</p>
            <p className="text-xs text-text-muted mb-6">{t("kitchen.offShiftDesc")}</p>
            <LogoutButton role="kitchen" className="w-full justify-center py-3 rounded-xl bg-sand-900 text-white font-bold text-sm" />
          </div>
        </div>
      )}

      {/* ─── HEADER ─────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b border-sand-200">
        <div className="max-w-6xl mx-auto px-3 sm:px-4 py-2.5 sm:py-3">
          {/* Title row — name + badges on the left, utility cluster on the right.
              Below sm, Schedule + Language collapse into a kebab so the row can breathe. */}
          <div className="flex items-center gap-2 mb-3">
            <div className="min-w-0 flex-1 flex items-center gap-2">
              <div className="min-w-0">
                <h1 className="text-sm sm:text-lg font-semibold text-text-primary tracking-tight flex items-center gap-1.5 truncate">
                  <span className="truncate">{staff.name}</span>
                  <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider px-1.5 sm:px-2 py-0.5 rounded-lg bg-status-warn-100 text-status-warn-600 flex-shrink-0">{t("kitchen.badge")}</span>
                  <span className={`w-2 h-2 rounded-full ${isOnShift ? "bg-status-good-500" : "bg-status-bad-500"} animate-pulse flex-shrink-0`} />
                </h1>
                <p className="hidden sm:block text-[10px] text-text-secondary font-semibold mt-0.5 truncate">{t("kitchen.title")}</p>
              </div>
              <span className={`hidden sm:inline-flex text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full flex-shrink-0 ${
                capacity >= critical ? "bg-status-bad-100 text-status-bad-600"
                : capacity >= warn ? "bg-status-warn-100 text-status-warn-600"
                : "bg-status-good-100 text-status-good-600"
              }`}>
                {loadLevel}
              </span>
              {alerts.filter((a) => a.severity === "critical").length > 0 && (
                <span className="text-[10px] font-bold bg-status-bad-500 text-white px-2 py-0.5 rounded-full animate-pulse tabular-nums flex-shrink-0">
                  {alerts.filter((a) => a.severity === "critical").length}
                </span>
              )}
            </div>
            <ClockButton staffId={staff.id} name={staff.name} role={staff.role} />
            {/* Always-visible language toggle (compact for mobile). */}
            <LanguageToggle
              lang={lang}
              onToggle={toggleLang}
              className="h-8 px-2.5 rounded-xl text-[11px] font-bold bg-sand-100 text-text-secondary hover:bg-sand-200 transition active:scale-95"
            />
            {/* Desktop: inline history + schedule + logout. */}
            <div className="hidden sm:flex items-center gap-2">
              <button onClick={() => setShowHistory(true)} className="p-2 hover:bg-sand-100 rounded-xl transition" title="Order history">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><polyline points="3 3 3 8 8 8"/><polyline points="12 7 12 12 15 14"/></svg>
              </button>
              <button onClick={() => setShowSchedule(true)} className="p-2 hover:bg-sand-100 rounded-xl transition" title={t("kitchen.mySchedule")}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </button>
              <LogoutButton role="kitchen" />
            </div>
            {/* Mobile kebab: schedule + logout. Language is now always
                visible above so it's reachable in one tap. */}
            <StaffHeaderMenu
              lang={lang}
              onToggleLang={toggleLang}
              onOpenSchedule={() => setShowSchedule(true)}
              logoutRole="kitchen"
              scheduleLabel={t("kitchen.mySchedule")}
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

          {/* KPI row */}
          <div className="grid grid-cols-5 gap-1.5 sm:gap-4">
            {[
              { label: t("kitchen.queue"), value: activeOrders.length, color: activeOrders.length >= 6 ? "text-status-bad-600" : "text-text-primary" },
              { label: t("kitchen.pending"), value: pendingC, color: pendingC > 0 ? "text-status-warn-600" : "text-text-muted" },
              { label: t("kitchen.prepping"), value: preparingC, color: "text-status-wait-600" },
              { label: t("kitchen.ready"), value: readyC, color: readyC > 0 ? "text-status-good-600" : "text-text-muted" },
              { label: t("kitchen.avgWait"), value: `${avgWait}m`, color: avgWait > 12 ? "text-status-bad-600" : "text-text-secondary" },
            ].map((kpi) => (
              <div key={kpi.label} className="text-center min-w-0">
                <div className={`text-base sm:text-xl font-semibold tabular-nums ${kpi.color}`}>{kpi.value}</div>
                <div className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-wider text-text-muted truncate">{kpi.label}</div>
              </div>
            ))}
          </div>
        </div>
      </header>
      {showSchedule && <SchedulePopup staffId={staff.id} role={staff.role} onClose={() => setShowSchedule(false)} />}
      {showHistory && <OrderHistoryDrawer orders={orders} role="kitchen" onClose={() => setShowHistory(false)} />}

      {/* ─── OWNER MESSAGES ──────────────────────── */}
      <AnimatePresence>
        {visibleOwnerMessages.length > 0 && (
          <div className="max-w-6xl mx-auto px-4 pt-3 space-y-2">
            {visibleOwnerMessages.map((msg) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex items-center gap-3 px-4 py-3 rounded-xl bg-status-wait-50 border-2 border-status-wait-200"
              >
                <span className="text-lg">{msg.type === "voice" ? "🎙" : "📢"}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-status-wait-800">{msg.type === "voice" ? t("kitchen.voiceNote") : t("kitchen.ownerMessage")}</p>
                  {(() => {
                    const body = localizedMessageText(msg, lang as "en" | "ar");
                    return body ? <p className="text-xs text-status-wait-600 truncate">{body}</p> : null;
                  })()}
                  {msg.type === "voice" && msg.audio && (
                    <button
                      onClick={() => { const a = new Audio(msg.audio!); a.play().catch(() => {}); }}
                      className="text-[10px] font-bold text-status-wait-700 mt-1 underline"
                    >
                      {t("kitchen.playAgain")}
                    </button>
                  )}
                </div>
                <button
                  onClick={() => setDismissedMessages((s) => new Set([...s, msg.id]))}
                  className="text-status-wait-400 hover:text-status-wait-600 text-sm font-bold"
                >
                  ✕
                </button>
              </motion.div>
            ))}
          </div>
        )}
      </AnimatePresence>

      {/* ─── TAB BAR ──────────────────────────────── */}
      <div className="max-w-6xl mx-auto px-4 pt-3">
        <div className="flex gap-1 bg-sand-100 rounded-xl p-1">
          {([
            { id: "orders" as const, label: t("kitchen.orders"), icon: "🔥" },
            { id: "menu" as const, label: t("kitchen.menuAvailability"), icon: "📋" },
          ]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold transition-all ${
                activeTab === tab.id
                  ? "bg-white text-text-primary shadow-sm"
                  : "text-text-secondary hover:text-text-secondary"
              }`}
            >
              <span>{tab.icon}</span>
              {tab.label}
              {tab.id === "orders" && activeOrders.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-status-warn-100 text-status-warn-600 text-[10px] font-bold">{activeOrders.length}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ─── BODY ───────────────────────────────── */}
      {activeTab === "orders" ? (
      <div className="max-w-6xl mx-auto px-4 py-4">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
          {/* Left: Queue */}
          <div className="space-y-3">
            {/* Alerts — collapsed to single-line banners */}
            <AnimatePresence>
              {alerts.map((alert) => (
                <motion.div
                  key={alert.id}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold ${
                    alert.severity === "critical"
                      ? "bg-status-bad-50 text-status-bad-700 border border-status-bad-200"
                      : "bg-status-warn-50 text-status-warn-700 border border-status-warn-200"
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${alert.severity === "critical" ? "bg-status-bad-500 animate-pulse" : "bg-status-warn-400"}`} />
                  <span className="flex-1">{(() => {
                    const parts = alert.message.split("::");
                    const key = parts[0];
                    if (key === "kitchen.alert.overloaded") {
                      return t(key).replace("{station}", t(parts[1])).replace("{active}", parts[2]).replace("{capacity}", parts[3]);
                    }
                    if (key === "kitchen.alert.stuckPending") {
                      return t(key).replace("{count}", parts[1]);
                    }
                    if (key === "kitchen.alert.delayed") {
                      return t(key).replace("{count}", parts[1]);
                    }
                    if (key === "kitchen.kitchenAtMax") {
                      return t(key);
                    }
                    return alert.message;
                  })()}</span>
                  <button
                    onClick={() => setDismissedAlerts((prev) => new Set(prev).add(alert.id))}
                    className="text-xs opacity-50 hover:opacity-100"
                  >
                    {t("kitchen.dismiss")}
                  </button>
                </motion.div>
              ))}
            </AnimatePresence>

            {/* Order cards */}
            <AnimatePresence mode="popLayout">
              {sortedQueue.length === 0 ? (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-center py-20"
                >
                  <p className="text-text-muted text-sm font-medium">{t("kitchen.noActiveOrders")}</p>
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
            {/* Station loads */}
            <div className="bg-white rounded-xl border border-sand-200 p-4 shadow-sm">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-2">
                {t("kitchen.stationLoad")}
              </h3>
              <div className="space-y-0.5">
                {stationLoads.map((load) => (
                  <LoadBar key={load.station} load={load} />
                ))}
              </div>
            </div>

            {/* Capacity */}
            <div className="bg-white rounded-xl border border-sand-200 p-4 shadow-sm">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-2">
                {t("kitchen.capacity")}
              </h3>
              <div className="flex items-baseline gap-2">
                <span className={`text-3xl font-semibold tabular-nums ${loadColor}`}>{capacity}%</span>
                <span className="text-xs text-text-muted">{t("kitchen.ordersCapacity").replace("{current}", String(activeOrders.length)).replace("{max}", String(kitchenConfig.maxParallel))}</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-sand-100 overflow-hidden">
                <motion.div
                  className={`h-full rounded-full ${
                    capacity >= critical ? "bg-status-bad-500" : capacity >= warn ? "bg-status-warn-400" : "bg-status-good-400"
                  }`}
                  animate={{ width: `${Math.min(100, capacity)}%` }}
                  transition={{ duration: 0.4 }}
                />
              </div>
            </div>

            {/* Ready for pickup */}
            <div className="bg-white rounded-xl border border-sand-200 p-4 shadow-sm">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-2">
                {t("kitchen.readyForPickup")}
              </h3>
              <ReadyFeed orders={orders} now={now} onAdvance={advanceOrder} />
            </div>

            {/* Quick stats */}
            <div className="bg-white rounded-xl border border-sand-200 p-4 shadow-sm">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-text-muted mb-2">
                {t("kitchen.stats")}
              </h3>
              <div className="space-y-2.5">
                {[
                  { label: t("kitchen.avgPrep"), value: `${kitchen.avgPrepTime}m` },
                  { label: t("kitchen.ordersToday"), value: orders.length },
                  { label: t("kitchen.delayed"), value: delayedC > 0 ? delayedC : t("kitchen.none"), color: delayedC > 0 ? "text-status-bad-500" : "text-status-good-500" },
                ].map((row) => (
                  <div key={row.label} className="flex justify-between items-center">
                    <span className="text-xs text-text-muted">{row.label}</span>
                    <span className={`text-sm font-bold tabular-nums ${row.color || "text-text-secondary"}`}>{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      ) : (
        <MenuAvailabilityPanel staffId={staff.id} />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════
// KITCHEN LOGIN GATE
// ═══════════════════════════════════════════════════════

function KitchenLogin({ onLogin }: { onLogin: (staff: { id: string; name: string; role: string; shift: number }) => void }) {
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
      if (!res.ok) { const data = await res.json(); setError(data.error || t("login.invalidPin")); setLoading(false); return; }
      const staff = await res.json();
      if (staff.role !== "KITCHEN") { setError(t("kitchen.notKitchenPin")); setLoading(false); return; }
      onLogin(staff);
    } catch { setError(t("login.networkError")); }
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
          <div className="w-16 h-16 rounded-2xl bg-status-warn-600 flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl">🔥</span>
          </div>
          <h1 className="text-xl font-semibold text-white">{t("kitchen.login")}</h1>
          <p className="text-sm text-text-muted mt-1">{t("kitchen.loginDesc")}</p>
        </div>

        <div className="flex justify-center gap-3 mb-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`w-12 h-14 rounded-xl border-2 flex items-center justify-center text-xl font-semibold transition-all ${
              pin.length > i ? "border-status-warn-500 bg-status-warn-900/30 text-status-warn-400" : "border-sand-600 bg-sand-700 text-transparent"
            }`}>
              {pin.length > i ? "●" : "○"}
            </div>
          ))}
        </div>

        {error && (
          <motion.p className="text-center text-status-bad-400 text-sm font-semibold mb-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {error}
          </motion.p>
        )}

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
                key === "⌫" ? "bg-sand-700 text-text-muted" : key ? "bg-sand-700 text-white hover:bg-sand-600" : "invisible"
              }`}
            >{key}</button>
          ))}
        </div>

        <button onClick={handleSubmit} disabled={pin.length < 4 || loading}
          className={`w-full py-4 rounded-2xl text-lg font-bold transition-all ${
            pin.length >= 4 && !loading ? "bg-status-warn-600 text-white hover:bg-status-warn-700" : "bg-sand-700 text-text-secondary cursor-not-allowed"
          }`}
        >{loading ? t("login.verifying") : t("kitchen.openKitchen")}</button>
      </motion.div>
    </div>
  );
}

export default function KitchenPage() {
  const [staff, setStaff] = useState<StaffInfo | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const { lang } = useLanguage();

  useEffect(() => {
    try {
      const saved = localStorage.getItem("kitchen_staff");
      if (saved) {
        const parsed = JSON.parse(saved);
        const loginAt = parsed.loginAt || 0;
        if (Date.now() - loginAt < 16 * 60 * 60 * 1000) {
          setStaff({ id: parsed.id, name: parsed.name, role: parsed.role, shift: parsed.shift });
        } else {
          localStorage.removeItem("kitchen_staff");
        }
      }
    } catch { /* silent */ }
    setHydrated(true);
  }, []);

  // Push subscription, re-fired on lang change so notifications land
  // in the cashier's chosen language.
  useEffect(() => {
    if (!staff?.id) return;
    import("@/lib/push-client").then(({ subscribeToPush }) => {
      const restaurantSlug = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";
      subscribeToPush(staff.id, "KITCHEN", restaurantSlug, lang as "en" | "ar").catch(() => {});
    });
  }, [staff?.id, lang]);

  const handleLogin = useCallback((s: StaffInfo) => {
    localStorage.setItem("kitchen_staff", JSON.stringify({ ...s, loginAt: Date.now() }));
    setStaff(s);
    import("@/lib/notifications").then(({ requestNotificationPermission }) => {
      requestNotificationPermission();
    });
  }, []);

  if (!hydrated) {
    return (
      <div className="min-h-dvh bg-sand-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-sand-600 border-t-status-warn-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!staff) return <KitchenLogin onLogin={handleLogin} />;
  return <KitchenSystem staff={staff} />;
}
