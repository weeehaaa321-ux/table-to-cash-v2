"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { resolveImage } from "@/lib/placeholders";
import { useCart } from "@/store/cart";
import { useMenu } from "@/store/menu";
import { useAction } from "@/lib/engine/action";
import type { MenuItem, AddOn } from "@/types/menu";
import { AddOnSheet } from "@/presentation/components/ui/AddOnSheet";
import { useLanguage } from "@/lib/use-language";
import { LanguageToggle } from "@/presentation/components/ui/LanguageToggle";
import { getLocalizedName, getLocalizedDesc } from "@/i18n";
import Link from "next/link";
import { ChangeTableButton } from "@/presentation/components/ui/ChangeTableModal";
import { GuestBadge } from "@/presentation/components/ui/GuestBadge";
import { isSelfInitiatedMove } from "@/lib/self-move";

// ═══════════════════════════════════════════════
// ITEM DETAIL SHEET — Bottom sheet with full info
// ═══════════════════════════════════════════════

function ItemDetailSheet({
  item,
  onAdd,
  onClose,
  lang = "en",
}: {
  item: MenuItem;
  onAdd: (item: MenuItem) => void;
  onClose: () => void;
  lang?: string;
}) {
  const orderCounts = useAction((s) => s.orderCounts);
  const count = orderCounts.get(item.id) || 0;

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        className="relative w-full max-w-[430px] bg-white rounded-t-3xl overflow-hidden max-h-[85vh] overflow-y-auto"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 300 }}
      >
        {/* Image */}
        <div className="relative h-56 bg-sand-100">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${resolveImage(item.image)})` }}
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
          <button
            onClick={onClose}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center text-text-secondary shadow-lg"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          {/* Badges */}
          <div className="absolute bottom-3 left-4 flex gap-2">
            {item.bestSeller && (
              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-status-warn-400 text-status-warn-900 shadow-sm">
                Best Seller
              </span>
            )}
            {item.highMargin && !item.bestSeller && (
              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-status-wait-100 text-status-wait-700">
                Chef&apos;s Pick
              </span>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="p-5">
          <h2 className="text-xl font-semibold text-text-primary mb-1">
            {getLocalizedName(item, lang as "en" | "ar")}
          </h2>
          <p className="text-sm text-text-secondary leading-relaxed mb-4">
            {getLocalizedDesc(item, lang as "en" | "ar") || "No description available"}
          </p>

          {/* Meta row */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">
            {item.prepTime && (
              <span className="flex items-center gap-1.5 text-xs text-text-muted font-medium">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {item.prepTime} min
              </span>
            )}
            {item.calories && (
              <span className="flex items-center gap-1.5 text-xs text-text-muted font-medium">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" />
                </svg>
                {item.calories} cal
              </span>
            )}
            {count > 0 && (
              <span className="flex items-center gap-1.5 text-xs text-status-good-600 font-semibold">
                <span className="w-1.5 h-1.5 rounded-full bg-status-good-500" />
                {count} ordered today
              </span>
            )}
          </div>

          {/* Tags */}
          {item.tags.length > 0 && (
            <div className="flex gap-1.5 flex-wrap mb-4">
              {item.tags.map((tag) => (
                <span key={tag} className="px-2.5 py-1 rounded-full bg-sand-100 text-[10px] font-semibold text-text-secondary uppercase tracking-wide">
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Add-ons preview */}
          {item.addOns.length > 0 && (
            <div className="mb-5">
              <p className="text-[11px] font-bold text-text-muted uppercase tracking-widest mb-2">Customize</p>
              <div className="space-y-1.5">
                {item.addOns.map((addon) => (
                  <div key={addon.id} className="flex items-center justify-between px-3 py-2 rounded-xl bg-sand-50">
                    <span className="text-sm text-text-secondary">{addon.name}</span>
                    <span className="text-xs font-bold text-text-muted">+{addon.price} EGP</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Price + Add button */}
          <div className="flex items-center gap-4 pt-2 pb-2">
            <div>
              <span className="text-2xl font-semibold text-text-primary">{item.price}</span>
              <span className="text-sm text-text-muted ml-1">{lang === "ar" ? "ج.م" : "EGP"}</span>
            </div>
            <motion.button
              onClick={() => { onAdd(item); onClose(); }}
              className="flex-1 py-3.5 rounded-2xl bg-sand-900 text-white font-bold text-[15px] shadow-lg"
              whileTap={{ scale: 0.97 }}
            >
              {lang === "ar" ? "أضف للطلب" : "Add to Order"}
            </motion.button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════
// MENU ITEM CARD — Grid card (DoorDash style)
// ═══════════════════════════════════════════════

function MenuCard({
  item,
  onAdd,
  onTap,
  cartQty,
  lang = "en",
}: {
  item: MenuItem;
  onAdd: (item: MenuItem) => void;
  onTap: (item: MenuItem) => void;
  cartQty: number;
  lang?: string;
}) {
  return (
    <motion.div
      className="bg-white rounded-2xl border border-sand-100 overflow-hidden shadow-sm hover:shadow-md transition-shadow cursor-pointer"
      onClick={() => onTap(item)}
      whileTap={{ scale: 0.98 }}
      layout
    >
      {/* Image */}
      <div className="relative aspect-[4/3] bg-sand-100 overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center transition-transform duration-500 hover:scale-105"
          style={{ backgroundImage: `url(${resolveImage(item.image)})` }}
        />
        {/* Badges */}
        {item.bestSeller && (
          <div className="absolute top-2 left-2">
            <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-status-warn-400 text-status-warn-900">
              POPULAR
            </span>
          </div>
        )}
        {item.highMargin && !item.bestSeller && (
          <div className="absolute top-2 left-2">
            <span className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-status-wait-100 text-status-wait-700">
              CHEF&apos;S PICK
            </span>
          </div>
        )}
        {/* Cart qty badge */}
        {cartQty > 0 && (
          <motion.div
            className="absolute top-2 right-2 w-6 h-6 rounded-full bg-status-good-500 text-white text-[11px] font-bold flex items-center justify-center shadow-md"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", damping: 12 }}
          >
            {cartQty}
          </motion.div>
        )}
        {/* Quick add button */}
        <motion.button
          onClick={(e) => { e.stopPropagation(); onAdd(item); }}
          className="absolute bottom-2 right-2 w-9 h-9 rounded-full bg-white shadow-lg flex items-center justify-center border border-sand-100"
          whileTap={{ scale: 0.85 }}
        >
          <svg className="w-5 h-5 text-text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </motion.button>
      </div>

      {/* Info */}
      <div className="p-3">
        <h3 className="text-sm font-bold text-text-primary leading-tight mb-0.5 line-clamp-1">
          {getLocalizedName(item, lang as "en" | "ar")}
        </h3>
        <p className="text-[11px] text-text-muted line-clamp-2 leading-relaxed mb-2 min-h-[2rem]">
          {getLocalizedDesc(item, lang as "en" | "ar") || "\u00A0"}
        </p>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-text-primary">
            {item.price} <span className="text-[10px] font-medium text-text-muted">{lang === "ar" ? "ج.م" : "EGP"}</span>
          </span>
          <div className="flex items-center gap-2 text-[10px] text-text-muted">
            {item.prepTime && <span>{item.prepTime}m</span>}
            {item.calories && <span>{item.calories}cal</span>}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════
// SEARCH BAR
// ═══════════════════════════════════════════════

function SearchBar({ value, onChange, lang = "en" }: { value: string; onChange: (v: string) => void; lang?: string }) {
  return (
    <div className="relative">
      <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={lang === "ar" ? "ابحث في المنيو..." : "Search menu..."}
        className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-sand-100 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-sand-200 transition-all"
      />
      {value && (
        <button onClick={() => onChange("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// STICKY CART BAR — Bottom floating
// ═══════════════════════════════════════════════

function CartBar({ tableNumber, lang = "en" }: { tableNumber: string; lang?: string }) {
  const totalItems = useCart((s) => s.totalItems);
  const subtotal = useCart((s) => s.subtotal);
  const sessionId = useCart((s) => s.sessionId);

  const count = totalItems();
  const total = subtotal();

  if (count === 0) return null;

  return (
    <motion.div
      className="fixed bottom-0 left-0 right-0 z-40 p-3 safe-bottom max-w-[430px] mx-auto"
      initial={{ y: 100 }}
      animate={{ y: 0 }}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
    >
      <Link href={`/cart?table=${tableNumber}${sessionId ? `&session=${sessionId}` : ""}`}>
        <motion.div
          className="flex items-center justify-between px-5 py-3.5 rounded-2xl bg-sand-900 text-white shadow-2xl shadow-sand-900/30"
          whileTap={{ scale: 0.98 }}
        >
          <div className="flex items-center gap-3">
            <motion.span
              key={count}
              className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold"
              initial={{ scale: 1.5 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", damping: 12 }}
            >
              {count}
            </motion.span>
            <span className="font-semibold text-sm">{lang === "ar" ? "عرض السلة" : "View Cart"}</span>
          </div>
          <motion.span
            key={total}
            className="font-bold text-base tabular-nums"
            initial={{ y: -5, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
          >
            {total.toLocaleString()} {lang === "ar" ? "ج.م" : "EGP"}
          </motion.span>
        </motion.div>
      </Link>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════
// MAIN: MENU (DoorDash / Talabat style)
// ═══════════════════════════════════════════════

export function ImmersiveMenu({ tableNumber, restaurantSlug, sessionId }: { tableNumber: string; restaurantSlug?: string; sessionId?: string }) {
  const { lang, toggleLang, t, dir } = useLanguage();
  const [superCategory, setSuperCategory] = useState<"food" | "drinks">("food");
  const [activeCategory, setActiveCategory] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [showAddOns, setShowAddOns] = useState<MenuItem | null>(null);
  const [justAdded, setJustAdded] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const categoryBarRef = useRef<HTMLDivElement>(null);
  const isScrollingFromClick = useRef(false);

  const addItem = useCart((s) => s.addItem);
  const cartItems = useCart((s) => s.items);
  const cartTotalItems = useCart((s) => s.totalItems);
  const cartSubtotal = useCart((s) => s.subtotal);

  // Menu store
  const allItems = useMenu((s) => s.allItems);
  const categories = useMenu((s) => s.categories);
  const activeStations = useMenu((s) => s.activeStations);
  const menuLoaded = useMenu((s) => s.loaded);
  const menuLoading = useMenu((s) => s.loading);
  const menuError = useMenu((s) => s.error);
  const initializeMenu = useMenu((s) => s.initialize);

  const kitchenOpen = activeStations.includes("KITCHEN");
  const barOpen = activeStations.includes("BAR");

  const [sessionClosed, setSessionClosed] = useState(false);
  const [movedToTable, setMovedToTable] = useState<number | null>(null);
  const [hasActiveOrders, setHasActiveOrders] = useState(false);
  const isSessionOwner = useCart((s) => s.isSessionOwner);
  const cartOrderType = useCart((s) => s.orderType);
  const isVipSession = cartOrderType === "VIP_DINE_IN" || cartOrderType === "DELIVERY";

  // Initialize menu
  useEffect(() => {
    initializeMenu(restaurantSlug);
    if (sessionId) {
      useCart.getState().setSessionId(sessionId);
    }
  }, [restaurantSlug, initializeMenu, sessionId]);

  // Force-refresh menu on mount to pick up any availability changes since last load
  const refreshMenu = useMenu((s) => s.refresh);
  useEffect(() => {
    if (!menuLoaded) return;
    const purgeStale = () => {
      const available = new Set(useMenu.getState().allItems.map((i) => i.id));
      const cart = useCart.getState();
      const stale = cart.items.filter((ci) => !available.has(ci.menuItem.id));
      for (const ci of stale) cart.removeItem(ci.menuItem.id);
    };
    refreshMenu().then(purgeStale);
    const id = setInterval(() => { refreshMenu().then(purgeStale); }, 60_000);
    return () => clearInterval(id);
  }, [menuLoaded, refreshMenu]);

  // Auto-switch to available tab when a station is off
  useEffect(() => {
    if (!menuLoaded) return;
    if (superCategory === "food" && !kitchenOpen && barOpen) setSuperCategory("drinks");
    if (superCategory === "drinks" && !barOpen && kitchenOpen) setSuperCategory("food");
  }, [menuLoaded, kitchenOpen, barOpen, superCategory]);

  // Mark session as "browsing"
  useEffect(() => {
    if (!sessionId) return;
    fetch("/api/sessions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, action: "menu_opened" }),
    }).catch(() => {});
  }, [sessionId]);

  // Check for existing orders in this session (returning guest)
  useEffect(() => {
    if (!sessionId || !restaurantSlug) return;
    async function checkOrders() {
      try {
        const res = await fetch(`/api/orders?restaurantId=${restaurantSlug}&sessionId=${sessionId}`);
        if (res.ok) {
          const data = await res.json();
          const orders = data.orders || data || [];
          const active = orders.filter((o: { status?: string }) => {
            const s = (o.status || "").toLowerCase();
            return s !== "served" && s !== "paid";
          });
          setHasActiveOrders(active.length > 0);
        }
      } catch {}
    }
    checkOrders();
  }, [sessionId, restaurantSlug]);

  // Check session open — query by sessionId so table moves don't look like closures
  useEffect(() => {
    if (!sessionId) return;
    async function checkSession() {
      try {
        const res = await fetch(`/api/sessions?sessionId=${sessionId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!data.session) {
          setSessionClosed(true);
          return;
        }
        if (data.session.status === "CLOSED") {
          setSessionClosed(true);
          return;
        }
        // Session is OPEN but on a different table — guest moved
        const actualTable = data.tableNumber ?? data.session.table?.number;
        if (actualTable && String(actualTable) !== String(tableNumber)) {
          // Skip the generic "you've moved" overlay when the user just
          // initiated this move themselves — let ChangeTableButton's
          // confirmation screen (with the "Go to Table # Menu" link) stay
          // visible. Without this guard the 30s poll could race in and
          // unmount the modal's success overlay before the user clicks.
          if (isSelfInitiatedMove(sessionId, actualTable)) {
            return;
          }
          setMovedToTable(actualTable);
        } else {
          // URL table matches session — clear any stale "moved" overlay
          // so navigating to /menu?table=<new> actually lands on the menu
          setMovedToTable(null);
        }
      } catch {}
    }
    checkSession();
    const interval = setInterval(checkSession, 30000);
    return () => clearInterval(interval);
  }, [sessionId, tableNumber, restaurantSlug]);

  // Filter categories by super-category (Food = KITCHEN, Drinks = BAR)
  const filteredCategories = useMemo(
    () => categories.filter((c) =>
      superCategory === "food" ? c.station === "KITCHEN" : c.station === "BAR"
    ),
    [categories, superCategory]
  );
  const filteredItems = useMemo(
    () => {
      const catIds = new Set(filteredCategories.map((c) => c.id));
      return allItems.filter((i) => catIds.has(i.categoryId));
    },
    [allItems, filteredCategories]
  );

  // Cart quantity map
  const cartQtyMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const ci of cartItems) {
      map.set(ci.menuItem.id, (map.get(ci.menuItem.id) || 0) + ci.quantity);
    }
    return map;
  }, [cartItems]);

  // Filtered items per category
  const categorizedItems = useMemo(() => {
    const lq = searchQuery.toLowerCase().trim();

    if (lq) {
      // Search mode — search within current super-category
      const results = filteredItems.filter((i) =>
        i.available && (
          i.name.toLowerCase().includes(lq) ||
          (i.nameAr || "").includes(lq) ||
          (i.description || "").toLowerCase().includes(lq) ||
          (i.descAr || "").includes(lq) ||
          i.tags.some((t) => t.includes(lq))
        )
      );
      return [{ slug: "search", name: `Results for "${searchQuery}"`, items: results }];
    }

    return filteredCategories
      .filter((c) => c.items.some((i) => i.available))
      .map((c) => ({
        slug: c.slug,
        name: getLocalizedName(c, lang as "en" | "ar"),
        items: c.items.filter((i) => i.available),
      }));
  }, [searchQuery, filteredCategories, filteredItems, lang]);

  // Scroll-spy: update active category on scroll
  const handleScroll = useCallback(() => {
    if (isScrollingFromClick.current) return;
    if (!scrollContainerRef.current) return;
    if (searchQuery) return;

    const scrollTop = scrollContainerRef.current.scrollTop + 160;
    let current = "all";

    for (const [slug, el] of sectionRefs.current) {
      if (el.offsetTop <= scrollTop) {
        current = slug;
      }
    }

    setActiveCategory(current);
  }, [searchQuery]);

  // Scroll to category section
  const scrollToCategory = useCallback((slug: string) => {
    setActiveCategory(slug);
    setSearchQuery("");

    if (slug === "all") {
      scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }

    const el = sectionRefs.current.get(slug);
    if (el && scrollContainerRef.current) {
      isScrollingFromClick.current = true;
      const top = el.offsetTop - 140;
      scrollContainerRef.current.scrollTo({ top, behavior: "smooth" });
      setTimeout(() => { isScrollingFromClick.current = false; }, 800);
    }
  }, []);

  // Add item
  const handleAdd = useCallback(
    (item: MenuItem, addOns: AddOn[] = []) => {
      addItem(item, addOns);
      setJustAdded(true);
      setShowAddOns(null);
      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        navigator.vibrate(10);
      }
      setTimeout(() => setJustAdded(false), 600);
    },
    [addItem]
  );

  const handleAddTap = useCallback(
    (item: MenuItem) => {
      if (item.addOns.length > 0) {
        setShowAddOns(item);
      } else {
        handleAdd(item);
      }
    },
    [handleAdd]
  );

  // Session moved to another table — redirect
  if (movedToTable) {
    const newMenuUrl = `/menu?table=${movedToTable}&restaurant=${restaurantSlug}${sessionId ? `&session=${sessionId}` : ""}`;
    return (
      <div className="absolute inset-0 bg-gradient-to-b from-ocean-50 to-white flex items-center justify-center px-8" dir={dir}>
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-ocean-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-ocean-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
            </svg>
          </div>
          <p className="text-text-primary text-lg font-bold mb-2">
            {lang === "ar" ? "تم نقلك لطاولة أخرى" : "You've moved tables"}
          </p>
          <p className="text-text-secondary text-sm mb-5">
            {lang === "ar"
              ? `جلستك الآن على طاولة ${movedToTable}`
              : `Your session is now on Table ${movedToTable}`}
          </p>
          <a
            href={newMenuUrl}
            onClick={() => setMovedToTable(null)}
            className="inline-block px-8 py-3 rounded-2xl font-bold text-sm text-white shadow-lg bg-ocean-600 hover:bg-ocean-700 transition-colors"
          >
            {lang === "ar" ? `افتح طاولة ${movedToTable}` : `Go to Table ${movedToTable}`}
          </a>
        </div>
      </div>
    );
  }

  // Session closed
  if (sessionClosed) {
    const vipToken = typeof window !== "undefined" ? localStorage.getItem("ttc_vip_token") : null;
    return (
      <div className="absolute inset-0 bg-white flex items-center justify-center px-8" dir={dir}>
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-sand-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <p className="text-text-primary text-lg font-bold mb-2">{t("menu.sessionClosed")}</p>
          <p className="text-text-secondary text-sm mb-4">
            {isVipSession
              ? "This session has ended. You can start a new order from your VIP link."
              : t("menu.sessionClosedDesc")}
          </p>
          {isVipSession && vipToken && (
            <Link
              href={`/vip/${vipToken}`}
              className="inline-block px-6 py-3 rounded-xl bg-gradient-to-r from-status-warn-500 to-status-warn-600 text-white font-bold text-sm active:scale-95 transition"
            >
              Start New Order
            </Link>
          )}
        </div>
      </div>
    );
  }

  // Error
  if (menuError) {
    return (
      <div className="absolute inset-0 bg-white flex items-center justify-center px-8">
        <div className="text-center">
          <p className="text-text-primary text-lg font-bold mb-2">{t("menu.couldNotLoad")}</p>
          <p className="text-text-secondary text-sm mb-4">{menuError}</p>
          <button
            onClick={() => { useMenu.setState({ loaded: false, loading: false, error: null }); initializeMenu(restaurantSlug); }}
            className="px-6 py-3 bg-sand-900 text-white rounded-xl font-bold text-sm"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Loading
  if (!menuLoaded && menuLoading) {
    return (
      <div className="absolute inset-0 bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-sand-200 border-t-sand-800 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-text-muted text-sm">Loading menu...</p>
        </div>
      </div>
    );
  }

  const currentCartCount = cartTotalItems();

  return (
    <div className="absolute inset-0 bg-sand-50 flex flex-col" dir={dir} style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}>
      {/* ═══ HEADER ═══ */}
      <div className="bg-white border-b border-sand-100 safe-top">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 pt-12 pb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-sand-900 flex items-center justify-center">
              <span className="text-white text-xs font-semibold">{tableNumber}</span>
            </div>
            <div>
              <h1 className="text-base font-semibold text-text-primary leading-tight">
                {lang === "ar" ? "المنيو" : "Menu"}
              </h1>
              <GuestBadge />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ChangeTableButton tableNumber={tableNumber} restaurant={restaurantSlug || "neom-dahab"} />
            <button
              onClick={() => setShowSearch(!showSearch)}
              className="w-9 h-9 rounded-xl bg-sand-100 flex items-center justify-center"
            >
              <svg className="w-4.5 h-4.5 text-text-secondary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
            </button>
            <LanguageToggle lang={lang} onToggle={toggleLang} />
          </div>
        </div>

        {/* Search */}
        <AnimatePresence>
          {showSearch && (
            <motion.div
              className="px-4 pb-2"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
            >
              <SearchBar value={searchQuery} onChange={setSearchQuery} lang={lang} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Food / Drinks toggle */}
        <div className="flex gap-2 px-4 pt-2 pb-1">
          <button
            onClick={() => { if (kitchenOpen) { setSuperCategory("food"); setActiveCategory("all"); scrollContainerRef.current?.scrollTo({ top: 0 }); } }}
            disabled={!kitchenOpen}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
              !kitchenOpen
                ? "bg-sand-100 text-text-muted cursor-not-allowed"
                : superCategory === "food"
                  ? "bg-sand-900 text-white shadow-md"
                  : "bg-sand-100 text-text-muted"
            }`}
          >
            {lang === "ar" ? "🍽️ طعام" : "🍽️ Food"}
            {!kitchenOpen && <span className="block text-[9px] font-normal mt-0.5">{lang === "ar" ? "مغلق" : "Closed"}</span>}
          </button>
          <button
            onClick={() => { if (barOpen) { setSuperCategory("drinks"); setActiveCategory("all"); scrollContainerRef.current?.scrollTo({ top: 0 }); } }}
            disabled={!barOpen}
            className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
              !barOpen
                ? "bg-sand-100 text-text-muted cursor-not-allowed"
                : superCategory === "drinks"
                  ? "bg-sand-900 text-white shadow-md"
                  : "bg-sand-100 text-text-muted"
            }`}
          >
            {lang === "ar" ? "🥤 مشروبات" : "🥤 Drinks"}
            {!barOpen && <span className="block text-[9px] font-normal mt-0.5">{lang === "ar" ? "مغلق" : "Closed"}</span>}
          </button>
        </div>

        {/* Category tabs */}
        <div ref={categoryBarRef} className="flex gap-1 overflow-x-auto no-scrollbar px-4 py-2" style={{ touchAction: "pan-x" }}>
          <button
            onClick={() => scrollToCategory("all")}
            className={`flex-shrink-0 px-4 py-2 rounded-full text-xs font-bold transition-all ${
              activeCategory === "all" && !searchQuery
                ? "bg-sand-900 text-white shadow-sm"
                : "bg-sand-100 text-text-secondary"
            }`}
          >
            {lang === "ar" ? "الكل" : "All"}
          </button>
          {filteredCategories.map((cat) => (
            <button
              key={cat.slug}
              onClick={() => scrollToCategory(cat.slug)}
              className={`flex-shrink-0 px-4 py-2 rounded-full text-xs font-bold transition-all whitespace-nowrap ${
                activeCategory === cat.slug && !searchQuery
                  ? "bg-sand-900 text-white shadow-sm"
                  : "bg-sand-100 text-text-secondary"
              }`}
            >
              {cat.icon ? `${cat.icon} ` : ""}{getLocalizedName(cat, lang as "en" | "ar")}
            </button>
          ))}
        </div>
      </div>

      {/* ═══ SCROLLABLE CONTENT ═══ */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto pb-24"
        style={{ WebkitOverflowScrolling: "touch", overscrollBehaviorY: "contain", touchAction: "pan-y" }}
        onScroll={handleScroll}
      >
        {/* Best sellers banner (only in "All" view, no search) */}
        {activeCategory === "all" && !searchQuery && (() => {
          const bestSellers = filteredItems.filter((i) => i.bestSeller && i.available).slice(0, 6);
          if (bestSellers.length === 0) return null;
          return (
            <div className="px-4 pt-4 pb-2">
              <h2 className="text-sm font-semibold text-text-primary mb-2.5">
                {lang === "ar" ? "الأكثر طلباً" : "Most Popular"}
              </h2>
              <div className="flex gap-3 overflow-x-auto no-scrollbar pb-1" style={{ touchAction: "pan-x" }}>
                {bestSellers.map((item) => (
                  <motion.div
                    key={item.id}
                    className="flex-shrink-0 w-36 cursor-pointer"
                    onClick={() => setSelectedItem(item)}
                    whileTap={{ scale: 0.97 }}
                  >
                    <div className="relative aspect-square rounded-2xl overflow-hidden mb-2 bg-sand-100">
                      <div
                        className="absolute inset-0 bg-cover bg-center"
                        style={{ backgroundImage: `url(${resolveImage(item.image)})` }}
                      />
                      <motion.button
                        onClick={(e) => { e.stopPropagation(); handleAddTap(item); }}
                        className="absolute bottom-2 right-2 w-7 h-7 rounded-full bg-white shadow-md flex items-center justify-center"
                        whileTap={{ scale: 0.85 }}
                      >
                        <svg className="w-4 h-4 text-text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                      </motion.button>
                      {cartQtyMap.get(item.id) ? (
                        <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-status-good-500 text-white text-[9px] font-bold flex items-center justify-center">
                          {cartQtyMap.get(item.id)}
                        </div>
                      ) : null}
                    </div>
                    <p className="text-xs font-bold text-text-primary line-clamp-1">
                      {getLocalizedName(item, lang as "en" | "ar")}
                    </p>
                    <p className="text-[11px] font-semibold text-text-secondary">{item.price} EGP</p>
                  </motion.div>
                ))}
              </div>
            </div>
          );
        })()}

        {/* Category sections */}
        {categorizedItems.map((section) => (
          <div
            key={section.slug}
            ref={(el) => { if (el) sectionRefs.current.set(section.slug, el); }}
            className="px-4 pt-5"
          >
            <h2 className="text-sm font-semibold text-text-primary mb-3 sticky top-0 bg-sand-50 py-1 z-10">
              {section.name}
              <span className="text-text-muted font-medium ml-2 text-xs">{section.items.length}</span>
            </h2>
            <div className="grid grid-cols-2 gap-3 pb-1">
              {section.items.map((item) => (
                <div key={item.id}>
                  <MenuCard
                    item={item}
                    onAdd={handleAddTap}
                    onTap={setSelectedItem}
                    cartQty={cartQtyMap.get(item.id) || 0}
                    lang={lang}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Empty state */}
        {categorizedItems.length === 0 && (
          <div className="flex items-center justify-center h-48">
            <p className="text-text-muted text-sm">{lang === "ar" ? "لا توجد نتائج" : "No items found"}</p>
          </div>
        )}
      </div>

      {/* ═══ ADDED FEEDBACK ═══ */}
      <AnimatePresence>
        {justAdded && (
          <motion.div
            className="fixed top-20 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-status-good-500 text-white text-sm font-bold shadow-lg"
            initial={{ y: -20, opacity: 0, scale: 0.9 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -20, opacity: 0, scale: 0.9 }}
          >
            {lang === "ar" ? "تمت الإضافة ✓" : "Added to cart ✓"}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ ITEM DETAIL SHEET ═══ */}
      <AnimatePresence>
        {selectedItem && (
          <ItemDetailSheet
            item={selectedItem}
            onAdd={handleAddTap}
            onClose={() => setSelectedItem(null)}
            lang={lang}
          />
        )}
      </AnimatePresence>

      {/* ═══ ADD-ON SHEET ═══ */}
      <AnimatePresence>
        {showAddOns && (
          <AddOnSheet
            item={showAddOns}
            onAdd={(addOns) => handleAdd(showAddOns, addOns)}
            onClose={() => setShowAddOns(null)}
          />
        )}
      </AnimatePresence>

      {/* ═══ TRACK ORDER LINK (returning guests) — subtle so it doesn't compete with the cart bar ═══ */}
      <AnimatePresence>
        {hasActiveOrders && sessionId && (
          <motion.div
            className="fixed z-30 max-w-[430px] mx-auto"
            style={{ bottom: currentCartCount > 0 ? "72px" : "16px", left: 0, right: 0 }}
            initial={{ y: 10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 10, opacity: 0 }}
          >
            <div className="px-4">
              <Link
                href={`/track?table=${tableNumber}&restaurant=${restaurantSlug}${sessionId ? `&session=${sessionId}` : ""}`}
                className="flex items-center justify-center gap-1.5 w-full py-2 rounded-xl bg-white/90 backdrop-blur border border-sand-200 text-text-secondary font-semibold text-xs shadow-sm"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {lang === "ar" ? "تتبع الطلب" : "Track Order"}
              </Link>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ═══ CART BAR ═══ */}
      <CartBar tableNumber={tableNumber} lang={lang} />
    </div>
  );
}
