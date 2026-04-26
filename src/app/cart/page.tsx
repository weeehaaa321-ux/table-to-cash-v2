"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useCart } from "@/store/cart";
import { resolveImage } from "@/lib/placeholders";
import { useMenu } from "@/store/menu";
import { PhoneFrame } from "@/components/ui/PhoneFrame";
import { useLanguage } from "@/lib/use-language";
import { LanguageToggle } from "@/components/ui/LanguageToggle";
import Link from "next/link";
import type { MenuItem } from "@/types/menu";
import { GuestBadge } from "@/components/ui/GuestBadge";
import { JoinRequestOverlay } from "@/components/ui/JoinRequestOverlay";
import { ChangeTableButton } from "@/components/ui/ChangeTableModal";
import { CallWaiterButton } from "@/components/ui/CallWaiterButton";
import { startPoll } from "@/lib/polling";
import { DELIVERY_FEE } from "@/lib/restaurant-config";

// ═══════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════

function formatEGP(n: number) {
  return n.toLocaleString("en-EG");
}

function getMenuItems() {
  return useMenu.getState().allItems;
}

// ═══════════════════════════════════════════════
// TAG INFERENCE — uses explicit tags first, falls back to category name
// ═══════════════════════════════════════════════

const CATEGORY_TAG_MAP: Record<string, string[]> = {
  "breakfast": ["breakfast", "main"],
  "egg": ["breakfast", "main"],
  "chef": ["main"],
  "juice": ["drink", "juice"],
  "soft drink": ["drink"],
  "ice cream": ["dessert"],
  "milkshake": ["drink", "dessert"],
  "dessert": ["dessert"],
  "cocktail": ["drink", "cocktail"],
  "energy": ["drink"],
  "smoothie": ["drink", "juice"],
  "coffee": ["drink", "coffee"],
  "iced coffee": ["drink", "coffee"],
  "iced drink": ["drink"],
  "tea": ["drink", "coffee"],
  "sahlab": ["drink"],
  "salad": ["starter", "appetizer"],
  "starter": ["appetizer", "starter", "sharing"],
  "snack": ["appetizer", "starter"],
  "soup": ["starter", "appetizer"],
  "pasta": ["main"],
  "burger": ["main"],
  "pizza": ["main"],
  "sandwich": ["main"],
  "main": ["main"],
  "grill": ["main"],
  "seafood": ["main"],
  "steak": ["main"],
  "wrap": ["main"],
  "extra": ["extra"],
  "side": ["extra", "starter"],
};

function getCategoryMap(): Map<string, string> {
  const cats = useMenu.getState().categories;
  const map = new Map<string, string>();
  for (const c of cats) map.set(c.id, c.name);
  return map;
}

let _catMapCache: Map<string, string> | null = null;
let _catMapStamp = 0;

function catMap(): Map<string, string> {
  const now = useMenu.getState().lastRefresh;
  if (!_catMapCache || _catMapStamp !== now) {
    _catMapCache = getCategoryMap();
    _catMapStamp = now;
  }
  return _catMapCache;
}

function inferTagsFromCategory(categoryId: string): string[] {
  const name = catMap().get(categoryId)?.toLowerCase() || "";
  for (const [keyword, tags] of Object.entries(CATEGORY_TAG_MAP)) {
    if (name.includes(keyword)) return tags;
  }
  return [];
}

function getEffectiveTags(item: MenuItem): string[] {
  if (item.tags.length > 0) return item.tags;
  return inferTagsFromCategory(item.categoryId);
}

function itemHasTag(item: MenuItem, tag: string): boolean {
  return getEffectiveTags(item).includes(tag);
}

function itemHasAnyTag(item: MenuItem, tags: string[]): boolean {
  const effective = getEffectiveTags(item);
  return tags.some((t) => effective.includes(t));
}

// ═══════════════════════════════════════════════
// SMART UPSELL ENGINE
// Philosophy: suggest like a thoughtful waiter —
// context-aware, price-proportional, time-sensitive,
// never random, never annoying.
// ═══════════════════════════════════════════════

type BundleOffer = {
  id: string;
  title: string;
  description: string;
  items: MenuItem[];
};

type Suggestion = {
  item: MenuItem;
  reason: string;
  subtext: string;
  priority: number;
};

const DRINK_TAGS = ["drink", "cocktail", "wine", "beer", "juice", "coffee"];
const STARTER_TAGS = ["appetizer", "starter", "sharing"];
const HOT_DRINK_TAGS = ["coffee"];

function getHour(): number {
  return new Date().getHours();
}

function isBreakfastTime(): boolean {
  const h = getHour();
  return h >= 6 && h < 12;
}

function isEveningTime(): boolean {
  return getHour() >= 17;
}

function avgCartPrice(cartItems: MenuItem[]): number {
  if (cartItems.length === 0) return 0;
  return cartItems.reduce((s, i) => s + i.price, 0) / cartItems.length;
}

function findBest(
  candidates: MenuItem[],
  cartItemIds: Set<string>,
  prefer: "bestSeller" | "highMargin" | "priceMatch",
  refPrice?: number,
): MenuItem | undefined {
  const available = candidates.filter((i) => !cartItemIds.has(i.id) && i.available);
  if (available.length === 0) return undefined;

  if (prefer === "bestSeller") {
    const bs = available.find((i) => i.bestSeller);
    if (bs) return bs;
  }
  if (prefer === "highMargin") {
    const hm = available.find((i) => i.highMargin);
    if (hm) return hm;
    const bs = available.find((i) => i.bestSeller);
    if (bs) return bs;
  }
  if (prefer === "priceMatch" && refPrice) {
    const sorted = [...available].sort(
      (a, b) => Math.abs(a.price - refPrice) - Math.abs(b.price - refPrice)
    );
    const bs = sorted.find((i) => i.bestSeller);
    return bs || sorted[0];
  }
  return available.find((i) => i.bestSeller) || available[0];
}

function detectBundles(cartItemIds: Set<string>, cartItems: MenuItem[]): BundleOffer[] {
  const bundles: BundleOffer[] = [];
  const menu = getMenuItems();

  const mainInCart = cartItems.find((i) => itemHasTag(i, "main"));
  const hasDrink = cartItems.some((i) => itemHasAnyTag(i, DRINK_TAGS));

  // Main + no drink → suggest a drink that matches the price tier
  if (mainInCart && !hasDrink) {
    const drinkPool = menu.filter((i) => itemHasAnyTag(i, DRINK_TAGS) && !itemHasTag(i, "extra"));
    const targetPrice = mainInCart.price * 0.4;
    const bestDrink = findBest(drinkPool, cartItemIds, "priceMatch", targetPrice);
    if (bestDrink) {
      bundles.push({
        id: `combo-main-drink-${mainInCart.id}`,
        title: "Pairs Well Together",
        description: `${bestDrink.name} goes great with your meal`,
        items: [bestDrink],
      });
    }
  }

  // Dessert in cart → suggest coffee/hot drink (classic pairing)
  const dessertInCart = cartItems.find((i) => itemHasTag(i, "dessert"));
  if (dessertInCart) {
    const coffeePool = menu.filter((i) => itemHasTag(i, "coffee"));
    const coffee = findBest(coffeePool, cartItemIds, "bestSeller");
    if (coffee) {
      bundles.push({
        id: `combo-dessert-coffee`,
        title: "Sweet Finish",
        description: `${coffee.name} pairs perfectly`,
        items: [coffee],
      });
    }
  }

  // Heavy meal (2+ mains/pasta/burger, total > 400) → suggest sharing starter
  const mainCount = cartItems.filter((i) => itemHasTag(i, "main")).length;
  const cartTotal = cartItems.reduce((s, i) => s + i.price, 0);
  const hasStarter = cartItems.some((i) => itemHasAnyTag(i, STARTER_TAGS));
  if (mainCount >= 2 && cartTotal > 400 && !hasStarter) {
    const sharingPool = menu.filter((i) => itemHasAnyTag(i, ["sharing", "starter"]));
    const sharing = findBest(sharingPool, cartItemIds, "bestSeller");
    if (sharing) {
      bundles.push({
        id: `combo-sharing`,
        title: "Great for the Table",
        description: `Share ${sharing.name} while you wait`,
        items: [sharing],
      });
    }
  }

  return bundles.slice(0, 2);
}

// Contextual pairing rules — what a waiter would actually recommend
const PAIRING_RULES: {
  if: (cart: MenuItem[]) => boolean;
  unless: (cart: MenuItem[]) => boolean;
  find: (menu: MenuItem[], ids: Set<string>, cart: MenuItem[]) => MenuItem | undefined;
  reason: string;
  subtext: string;
  priority: number;
}[] = [
  // ── 1. No drink at all → always suggest one ──
  {
    if: (cart) => cart.length >= 1,
    unless: (cart) => cart.some((i) => itemHasAnyTag(i, DRINK_TAGS)),
    find: (menu, ids, cart) => {
      const avg = avgCartPrice(cart);
      if (isBreakfastTime()) {
        const juices = menu.filter((i) => itemHasAnyTag(i, ["juice"]));
        return findBest(juices, ids, "bestSeller") ||
          findBest(menu.filter((i) => itemHasTag(i, "coffee")), ids, "bestSeller");
      }
      if (isEveningTime() && avg > 200) {
        const cocktails = menu.filter((i) => itemHasTag(i, "cocktail"));
        return findBest(cocktails, ids, "bestSeller") ||
          findBest(menu.filter((i) => itemHasAnyTag(i, DRINK_TAGS)), ids, "priceMatch", avg * 0.4);
      }
      const drinkPool = menu.filter((i) => itemHasAnyTag(i, DRINK_TAGS) && !itemHasTag(i, "extra"));
      return findBest(drinkPool, ids, "priceMatch", avg * 0.4);
    },
    reason: isBreakfastTime() ? "Start your morning right" : "Complete your meal",
    subtext: isBreakfastTime() ? "Freshly squeezed, made to order" : "Most guests add a drink",
    priority: 0,
  },

  // ── 2. Has main but no starter → suggest one ──
  {
    if: (cart) => cart.some((i) => itemHasTag(i, "main")),
    unless: (cart) => cart.some((i) => itemHasAnyTag(i, STARTER_TAGS)),
    find: (menu, ids) => {
      const starters = menu.filter((i) => itemHasAnyTag(i, STARTER_TAGS));
      return findBest(starters, ids, "bestSeller");
    },
    reason: "While you wait",
    subtext: "Arrives before your main course",
    priority: 2,
  },

  // ── 3. Meal is building (2+ items, no dessert) → suggest dessert ──
  {
    if: (cart) => cart.length >= 2,
    unless: (cart) => cart.some((i) => itemHasTag(i, "dessert")),
    find: (menu, ids) => {
      const desserts = menu.filter((i) => itemHasTag(i, "dessert"));
      return findBest(desserts, ids, "bestSeller");
    },
    reason: "Save room for dessert?",
    subtext: "Our most-loved sweet finish",
    priority: 3,
  },

  // ── 4. Only drinks in cart → suggest a snack/starter ──
  {
    if: (cart) => cart.length >= 1 && cart.every((i) => itemHasAnyTag(i, DRINK_TAGS)),
    unless: () => false,
    find: (menu, ids) => {
      const snacks = menu.filter((i) => itemHasAnyTag(i, ["starter", "appetizer", "sharing"]));
      return findBest(snacks, ids, "bestSeller");
    },
    reason: "Something to go with that?",
    subtext: "Our guests' favorite bites",
    priority: 1,
  },

  // ── 5. Breakfast items but no coffee → suggest coffee ──
  {
    if: (cart) => cart.some((i) => itemHasTag(i, "breakfast")),
    unless: (cart) => cart.some((i) => itemHasAnyTag(i, HOT_DRINK_TAGS)),
    find: (menu, ids) => {
      const coffees = menu.filter((i) => itemHasTag(i, "coffee"));
      return findBest(coffees, ids, "bestSeller");
    },
    reason: "Coffee with breakfast?",
    subtext: "Freshly brewed, made your way",
    priority: 1,
  },

  // ── 6. Pasta/pizza → suggest a salad (balance the meal) ──
  {
    if: (cart) => {
      const catNames = cart.map((i) => catMap().get(i.categoryId)?.toLowerCase() || "");
      return catNames.some((n) => n.includes("pasta") || n.includes("pizza"));
    },
    unless: (cart) => cart.some((i) => {
      const cn = catMap().get(i.categoryId)?.toLowerCase() || "";
      return cn.includes("salad") || itemHasAnyTag(i, STARTER_TAGS);
    }),
    find: (menu, ids) => {
      const salads = menu.filter((i) => {
        const cn = catMap().get(i.categoryId)?.toLowerCase() || "";
        return cn.includes("salad");
      });
      return findBest(salads, ids, "bestSeller");
    },
    reason: "Balance your meal",
    subtext: "A fresh salad goes perfectly with pasta",
    priority: 2,
  },

  // ── 7. Burger → suggest milkshake ──
  {
    if: (cart) => {
      const catNames = cart.map((i) => catMap().get(i.categoryId)?.toLowerCase() || "");
      return catNames.some((n) => n.includes("burger"));
    },
    unless: (cart) => cart.some((i) => {
      const cn = catMap().get(i.categoryId)?.toLowerCase() || "";
      return cn.includes("milkshake");
    }),
    find: (menu, ids) => {
      const shakes = menu.filter((i) => {
        const cn = catMap().get(i.categoryId)?.toLowerCase() || "";
        return cn.includes("milkshake");
      });
      return findBest(shakes, ids, "bestSeller");
    },
    reason: "Classic combo",
    subtext: "Burger + milkshake — can't go wrong",
    priority: 1,
  },

  // ── 8. Only hot drinks → suggest dessert/pastry ──
  {
    if: (cart) => cart.length >= 1 && cart.every((i) => itemHasAnyTag(i, HOT_DRINK_TAGS)),
    unless: (cart) => cart.some((i) => itemHasTag(i, "dessert")),
    find: (menu, ids) => {
      const sweets = menu.filter((i) => itemHasTag(i, "dessert"));
      return findBest(sweets, ids, "bestSeller");
    },
    reason: "Sweet side?",
    subtext: "Our favorites pair beautifully with coffee",
    priority: 1,
  },

  // ── 9. High-value order (500+) without soup → suggest soup ──
  {
    if: (cart) => cart.reduce((s, i) => s + i.price, 0) > 500 && cart.some((i) => itemHasTag(i, "main")),
    unless: (cart) => cart.some((i) => {
      const cn = catMap().get(i.categoryId)?.toLowerCase() || "";
      return cn.includes("soup");
    }),
    find: (menu, ids) => {
      const soups = menu.filter((i) => {
        const cn = catMap().get(i.categoryId)?.toLowerCase() || "";
        return cn.includes("soup");
      });
      return findBest(soups, ids, "bestSeller");
    },
    reason: "Start with a warm bowl?",
    subtext: "A refined way to begin your meal",
    priority: 2,
  },
];

function computeSuggestions(cartItemIds: Set<string>, cartItems: MenuItem[]): Suggestion[] {
  const menu = getMenuItems();
  const suggestions: Suggestion[] = [];
  const suggestedIds = new Set<string>();

  for (const rule of PAIRING_RULES) {
    if (suggestions.length >= 3) break;
    if (!rule.if(cartItems)) continue;
    if (rule.unless(cartItems)) continue;

    const item = rule.find(menu, cartItemIds, cartItems);
    if (!item || suggestedIds.has(item.id)) continue;

    suggestedIds.add(item.id);
    suggestions.push({
      item,
      reason: typeof rule.reason === "string" ? rule.reason : rule.reason,
      subtext: typeof rule.subtext === "string" ? rule.subtext : rule.subtext,
      priority: rule.priority,
    });
  }

  return suggestions.sort((a, b) => a.priority - b.priority).slice(0, 3);
}

// ═══════════════════════════════════════════════
// MEAL PROGRESS — Compact inline version
// ═══════════════════════════════════════════════

function MealProgress({ items }: { items: MenuItem[] }) {
  const hasStarter = items.some((i) =>
    itemHasAnyTag(i, ["appetizer", "starter"])
  );
  const hasMain = items.some((i) => itemHasTag(i, "main"));
  const hasDrink = items.some((i) =>
    itemHasAnyTag(i, ["drink", "cocktail", "wine", "beer", "juice", "coffee"])
  );
  const hasDessert = items.some((i) => itemHasTag(i, "dessert"));

  const stages = [
    { key: "starter", label: "Starter", done: hasStarter },
    { key: "main", label: "Main", done: hasMain },
    { key: "drink", label: "Drink", done: hasDrink },
    { key: "dessert", label: "Dessert", done: hasDessert },
  ];
  const completed = stages.filter((s) => s.done).length;

  if (items.length === 0) return null;

  return (
    <div className="mx-5 mt-4">
      <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 border border-sand-100">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-bold text-text-secondary uppercase tracking-widest">
            Meal Builder
          </span>
          <span className="text-[11px] font-semibold text-text-muted">
            {completed}/4
          </span>
        </div>
        <div className="flex gap-1.5">
          {stages.map((stage) => (
            <div key={stage.key} className="flex-1">
              <motion.div
                className={`h-1.5 rounded-full transition-all duration-500 ${
                  stage.done
                    ? "bg-gradient-to-r from-status-good-400 to-status-good-500"
                    : "bg-sand-100"
                }`}
                initial={false}
                animate={{ opacity: stage.done ? 1 : 0.5 }}
              />
              <p className={`text-[9px] font-semibold mt-1.5 text-center transition-colors ${
                stage.done ? "text-status-good-600" : "text-text-muted"
              }`}>
                {stage.label}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// SUGGESTION CARDS — Horizontal scroll
// ═══════════════════════════════════════════════

function SuggestionCards({
  suggestions,
  bundles,
  onAddItem,
}: {
  suggestions: Suggestion[];
  bundles: BundleOffer[];
  onAddItem: (itemId: string) => void;
}) {
  if (suggestions.length === 0 && bundles.length === 0) return null;

  return (
    <div className="mt-6">
      <p className="px-5 text-[11px] font-bold text-text-muted uppercase tracking-widest mb-3">
        Complete Your Experience
      </p>
      <div className="flex gap-3 overflow-x-auto no-scrollbar px-5 pb-1">
        {/* Unified card style for bundles and suggestions */}
        {[
          ...bundles.flatMap((b) =>
            b.items.map((item) => ({ item, reason: b.title, subtext: b.description }))
          ),
          ...suggestions.map((s) => ({ item: s.item, reason: s.reason, subtext: s.subtext })),
        ].map(({ item, reason, subtext }) => (
          <motion.div
            key={item.id}
            className="flex-shrink-0 w-52 bg-white rounded-2xl shadow-sm overflow-hidden border border-sand-100"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
          >
            <div className="relative h-28">
              <div
                className="absolute inset-0 bg-cover bg-center"
                style={{ backgroundImage: `url(${resolveImage(item.image)})` }}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
              <div className="absolute bottom-2.5 left-3 right-3">
                <p className="text-white text-[11px] font-bold">{reason}</p>
                <p className="text-white/60 text-[10px]">{subtext}</p>
              </div>
              {item.bestSeller && (
                <div className="absolute top-2 left-2">
                  <span className="px-2 py-0.5 rounded-full bg-status-warn-400 text-black text-[9px] font-bold">Best Seller</span>
                </div>
              )}
            </div>
            <div className="p-3">
              <p className="font-semibold text-text-primary text-sm truncate">{item.name}</p>
              <div className="flex items-center justify-between mt-2">
                <span className="font-bold text-ocean-600 text-sm">{item.price} EGP</span>
                <motion.button
                  onClick={() => onAddItem(item.id)}
                  className="px-3.5 py-1.5 rounded-xl bg-sand-900 text-white text-xs font-bold"
                  whileTap={{ scale: 0.95 }}
                >
                  + Add
                </motion.button>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// DROP-OFF RECOVERY
// ═══════════════════════════════════════════════

function DropOffRecovery({
  show,
  onAddItem,
  onDismiss,
}: {
  show: boolean;
  onAddItem: (itemId: string) => void;
  onDismiss: () => void;
}) {
  const items = useCart((s) => s.items);
  const ids = new Set(items.map((i) => i.menuItem.id));
  const bestSeller = getMenuItems().find(
    (i) => i.bestSeller && i.highMargin && !ids.has(i.id)
  );

  if (!show || !bestSeller) return null;

  return (
    <motion.div
      className="fixed bottom-0 left-0 right-0 z-50 p-4 safe-bottom"
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      transition={{ type: "spring", damping: 25, stiffness: 300 }}
    >
      <div className="max-w-[430px] mx-auto">
        <div className="bg-white/95 backdrop-blur-xl rounded-2xl p-4 shadow-2xl border border-sand-200">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-xl overflow-hidden flex-shrink-0 ring-1 ring-black/5">
              <div
                className="w-full h-full bg-cover bg-center"
                style={{ backgroundImage: `url(${resolveImage(bestSeller.image)})` }}
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-ocean-600 uppercase tracking-widest">
                Before you go...
              </p>
              <p className="font-semibold text-text-primary text-sm truncate">
                {bestSeller.name}
              </p>
              <p className="text-xs text-text-muted">{bestSeller.price} EGP</p>
            </div>
            <div className="flex flex-col gap-1.5 flex-shrink-0">
              <motion.button
                onClick={() => { onAddItem(bestSeller.id); onDismiss(); }}
                className="px-4 py-2 rounded-xl bg-sand-900 text-white text-xs font-bold"
                whileTap={{ scale: 0.95 }}
              >
                Add
              </motion.button>
              <button onClick={onDismiss} className="text-[10px] text-text-muted text-center">
                No thanks
              </button>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════
// REINFORCEMENT MESSAGES
// ═══════════════════════════════════════════════

function getReinforcementMessage(
  itemCount: number,
  total: number,
  hasUpsells: boolean
): string | null {
  if (hasUpsells && itemCount >= 3) return "Great selections — chef-approved choices";
  if (total > 500) return "Premium order — you have excellent taste";
  if (itemCount >= 4) return "Full meal assembled — looking good!";
  if (itemCount === 1) return "Great start — add more to make it a meal";
  return null;
}

// ═══════════════════════════════════════════════
// SCAN-REQUIRED GATE — shown when /cart is opened without
// a real session + table. Direct URL access bypasses the
// /scan handshake, so refuse instead of pretending to work.
// ═══════════════════════════════════════════════

function ScanRequiredScreen() {
  return (
    <div className="min-h-dvh bg-black flex items-center justify-center p-6">
      <div className="w-full max-w-sm bg-white rounded-3xl p-8 text-center shadow-2xl">
        <div className="mx-auto w-14 h-14 rounded-2xl bg-status-warn-50 border border-status-warn-200 flex items-center justify-center mb-4">
          <svg className="w-7 h-7 text-status-warn-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m0 14v1m8-8h-1M5 12H4m13.66-5.66l-.7.7M6.34 17.66l-.7.7m12.02 0l-.7-.7M6.34 6.34l-.7-.7M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-text-primary mb-2">Scan your table&apos;s QR</h1>
        <p className="text-sm text-text-secondary leading-relaxed">
          Open your cart by scanning the QR code on your table. That&apos;s how we know which table to send your order to.
        </p>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// MAIN: CART + CHECKOUT ENGINE
// ═══════════════════════════════════════════════

export default function CartPageWrapper() {
  return (
    <Suspense fallback={
      <PhoneFrame>
        <div className="h-full flex items-center justify-center bg-sand-50">
          <div className="w-8 h-8 rounded-full border-2 border-sand-200 border-t-sand-400 animate-spin" />
        </div>
      </PhoneFrame>
    }>
      <CartPage />
    </Suspense>
  );
}

function CartPage() {
  const { lang, toggleLang, t, dir } = useLanguage();
  const searchParams = useSearchParams();
  const tableNumber = searchParams.get("table") ?? "1";
  const urlSession = searchParams.get("session");
  const restaurantSlug = useMenu((s) => s.restaurantSlug) || process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";
  const storeSessionId = useCart((s) => s.sessionId);

  // Sync session from URL into cart store so non-owner guests can load this page
  // when opening a shared link without prior in-store state.
  useEffect(() => {
    if (urlSession && urlSession !== storeSessionId) {
      useCart.getState().setSessionId(urlSession);
    }
  }, [urlSession, storeSessionId]);

  const sessionId = urlSession || storeSessionId;
  const menuUrl = `/menu?table=${tableNumber}&restaurant=${restaurantSlug}${sessionId ? `&session=${sessionId}` : ""}`;

  // Block direct /cart navigation. Without a real session + table the page
  // would render against the default ?table=1 and let someone send orders
  // to a table they aren't seated at. The handshake comes from /scan.
  const urlTable = searchParams.get("table");
  if (!sessionId || !urlTable) {
    return <ScanRequiredScreen />;
  }

  const items = useCart((s) => s.items);
  const isSessionOwner = useCart((s) => s.isSessionOwner);
  const updateQuantity = useCart((s) => s.updateQuantity);
  const updateNotes = useCart((s) => s.updateNotes);
  const removeItem = useCart((s) => s.removeItem);
  const addItem = useCart((s) => s.addItem);
  const subtotal = useCart((s) => s.subtotal);

  const [orderPlaced, setOrderPlaced] = useState(false);
  const [placedOrderId, setPlacedOrderId] = useState<string | null>(null);
  const [placedOrderSummary, setPlacedOrderSummary] = useState<{
    items: { name: string; quantity: number; price: number }[];
    grandTotal: number;
  } | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDropOff, setShowDropOff] = useState(false);
  const [dropOffDismissed, setDropOffDismissed] = useState(false);
  const [sessionOrders, setSessionOrders] = useState<{ id: string; orderNumber: number; items: { name: string; quantity: number; price: number }[] }[]>([]);
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(new Set());

  // Drop-off recovery: detect idle on checkout page
  const idleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const resetIdle = useCallback(() => {
    if (idleTimer.current) clearTimeout(idleTimer.current);
    if (dropOffDismissed) return;
    idleTimer.current = setTimeout(() => {
      setShowDropOff(true);
    }, 12000);
  }, [dropOffDismissed]);

  useEffect(() => {
    resetIdle();
    const events = ["scroll", "touchstart", "click"];
    const handler = () => {
      setShowDropOff(false);
      resetIdle();
    };
    events.forEach((e) => window.addEventListener(e, handler, { passive: true }));
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      events.forEach((e) => window.removeEventListener(e, handler));
    };
  }, [resetIdle]);

  // Poll session for existing orders at this table (bundled endpoint)
  useEffect(() => {
    if (!sessionId) return;
    const slug = useMenu.getState().restaurantSlug || restaurantSlug;
    async function fetchSessionOrders() {
      try {
        const res = await fetch(`/api/guest-poll?sessionId=${sessionId}&tableNumber=${tableNumber}&restaurantId=${slug}`);
        if (res.ok) {
          const data = await res.json();
          if (data.session?.status === "CLOSED") {
            setOrderError("This session was closed by the manager. Please scan the QR code to start a new session.");
            return;
          }
          if (data.orders) {
            setSessionOrders(data.orders.map((o: { id: string; orderNumber: number; items: { name: string; quantity: number; price: number }[] }) => ({
              id: o.id,
              orderNumber: o.orderNumber,
              items: (o.items || []).map((it) => ({
                name: it.name || "Item",
                quantity: it.quantity,
                price: it.price,
              })),
            })));
          }
        }
      } catch { /* silent */ }
    }
    fetchSessionOrders();
    const stop = startPoll(fetchSessionOrders, 24000);
    return () => stop();
  }, [sessionId, tableNumber, restaurantSlug]);

  const total = subtotal();
  const grandTotal = total;

  // Suggestions + Bundles
  const cartItemIds = new Set(items.map((i) => i.menuItem.id));
  const cartMenuItems = items.map((i) => i.menuItem);
  const suggestions = computeSuggestions(cartItemIds, cartMenuItems);
  const bundles = detectBundles(cartItemIds, cartMenuItems);

  // Reinforcement
  const hasUpsells = items.some((i) => i.wasUpsell);
  const reinforcement = getReinforcementMessage(items.length, total, hasUpsells);

  const handleAddSuggestion = useCallback(
    (itemId: string) => {
      const item = getMenuItems().find((i) => i.id === itemId);
      if (item) addItem(item, [], true);
    },
    [addItem]
  );

  const tableId = useCart((s) => s.tableId);
  const restaurantId = useCart((s) => s.restaurantId);
  const guestNumber = useCart((s) => s.guestNumber);
  const clearCart = useCart((s) => s.clearCart);
  const orderType = useCart((s) => s.orderType);
  const vipGuestId = useCart((s) => s.vipGuestId);
  const deliveryAddress = useCart((s) => s.deliveryAddress);
  const deliveryNotes = useCart((s) => s.deliveryNotes);
  const deliveryLat = useCart((s) => s.deliveryLat);
  const deliveryLng = useCart((s) => s.deliveryLng);
  const paymentMethod = useCart((s) => s.paymentMethod);
  const setPaymentMethod = useCart((s) => s.setPaymentMethod);
  const isDelivery = orderType === "DELIVERY";
  // Pre-submit display only — the server is the source of truth for
  // the actual fee (Order.deliveryFee). Imported from the same env
  // var the server reads so the pre-checkout estimate matches what the
  // order is created with.
  const canOrder = items.length > 0 && (!isDelivery || (!!paymentMethod && !!deliveryAddress));

  // Idempotency key for the current submit attempt. Persists across
  // network retries so a flaky connection can't duplicate the order.
  // Cleared on successful submission.
  const submitKeyRef = useRef<string | null>(null);

  const handlePlaceOrder = useCallback(async () => {
    if (!canOrder || isSubmitting) return;

    setIsSubmitting(true);
    setOrderError(null);

    if (!submitKeyRef.current) {
      submitKeyRef.current = `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    }

    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate([20, 50, 20]);
    }

    try {
      const mappedItems = items.map((i) => ({
        menuItemId: i.menuItem.id,
        name: i.menuItem.name,
        quantity: i.quantity,
        price: i.menuItem.price,
        addOns: i.selectedAddOns.map((a) => a.id),
        wasUpsell: i.wasUpsell || false,
        notes: i.notes,
      }));

      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurantId: useMenu.getState().restaurantSlug || restaurantId || "neom-dahab",
          tableId: tableId || (orderType !== "TABLE" ? undefined : `table-${tableNumber}`),
          sessionId: sessionId || undefined,
          items: mappedItems,
          subtotal: total,
          total: grandTotal,
          language: "en",
          guestNumber: guestNumber > 0 ? guestNumber : undefined,
          clientRequestId: submitKeyRef.current,
          ...(orderType !== "TABLE" ? {
            orderType,
            vipGuestId: vipGuestId || undefined,
            deliveryAddress: deliveryAddress || undefined,
            deliveryNotes: deliveryNotes || undefined,
            deliveryLat: deliveryLat ?? undefined,
            deliveryLng: deliveryLng ?? undefined,
            ...(isDelivery && paymentMethod ? { paymentMethod } : {}),
          } : {}),
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        if (errData?.error === "SESSION_CLOSED") {
          submitKeyRef.current = null;
          setOrderError("This session has been closed. Please scan the QR code on your table to start a new session.");
          return;
        }
        if (errData?.error === "ITEMS_UNAVAILABLE") {
          submitKeyRef.current = null;
          const names = (errData.items as string[]).join(", ");
          setOrderError(`Some items are no longer available: ${names}. Please remove them and try again.`);
          useMenu.getState().refresh();
          return;
        }
        throw new Error("API error");
      }

      const orderData = await res.json();
      setPlacedOrderId(orderData.id || null);

      // Use the server's authoritative total (already includes the
      // delivery fee for delivery orders). Falling back to the local
      // grandTotal only matters if the server didn't return one,
      // which shouldn't happen but the receipt should still render.
      setPlacedOrderSummary({
        items: items.map((i) => ({
          name: i.menuItem.name,
          quantity: i.quantity,
          price: i.menuItem.price,
        })),
        grandTotal: typeof orderData.total === "number" ? orderData.total : grandTotal,
      });
      clearCart();
      submitKeyRef.current = null;
      setOrderPlaced(true);
    } catch {
      setOrderError(
        "Something went wrong. Your order was not placed. Please try again."
      );
    } finally {
      setIsSubmitting(false);
    }
  }, [canOrder, isSubmitting, items, total, grandTotal, tableId, restaurantId, tableNumber, sessionId, clearCart, orderType, vipGuestId, deliveryAddress, deliveryNotes, deliveryLat, deliveryLng, isDelivery, paymentMethod]);

  // ─── Order Success ────────────────────────────
  if (orderPlaced) {
    return (
      <PhoneFrame>
        <div className="h-full bg-gradient-to-b from-sand-50 to-white flex flex-col items-center justify-center px-6 text-center" dir={dir}>
          {/* Animated success */}
          <motion.div
            className="relative mb-8"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", damping: 12, stiffness: 180 }}
          >
            <div className="w-24 h-24 rounded-full bg-gradient-to-br from-status-good-400 to-status-good-500 flex items-center justify-center shadow-xl shadow-status-good-500/20">
              <motion.svg
                className="w-12 h-12 text-white"
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                transition={{ delay: 0.3, duration: 0.5 }}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </motion.svg>
            </div>
            {/* Ripple effect */}
            <motion.div
              className="absolute inset-0 rounded-full border-2 border-status-good-400"
              initial={{ scale: 1, opacity: 0.5 }}
              animate={{ scale: 2, opacity: 0 }}
              transition={{ duration: 1.5, repeat: 2 }}
            />
          </motion.div>

          <motion.h1
            className="text-2xl font-semibold text-text-primary mb-2 tracking-tight"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            {lang === "ar" ? "تم تقديم طلبك!" : "Your Order Has Been Placed!"}
          </motion.h1>

          <motion.p
            className="text-text-secondary mb-6 max-w-xs text-sm font-light"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
          >
            {lang === "ar" ? "طلبك في الطريق إلى المطبخ" : "Your order has been sent to the kitchen"}
          </motion.p>

          {/* Order summary card */}
          <motion.div
            className="bg-white rounded-2xl p-5 shadow-sm border border-sand-100 w-full max-w-xs mb-8"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
          >
            <div className="space-y-2 mb-3">
              {(placedOrderSummary?.items ?? []).slice(0, 4).map((item, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span className="text-text-secondary">
                    <span className="font-semibold text-text-secondary">{item.quantity}x</span>{" "}
                    {item.name}
                  </span>
                </div>
              ))}
              {(placedOrderSummary?.items.length ?? 0) > 4 && (
                <p className="text-xs text-text-muted">+{(placedOrderSummary?.items.length ?? 0) - 4} more items</p>
              )}
            </div>
            {isDelivery && (
              <div className="flex justify-between text-sm mb-1">
                <span className="text-text-muted">Delivery fee</span>
                <span className="text-text-secondary font-semibold">{formatEGP(DELIVERY_FEE)} EGP</span>
              </div>
            )}
            <div className="border-t border-sand-100 pt-3 flex justify-between items-center">
              <span className="font-bold text-text-primary text-sm">Total</span>
              <span className="font-semibold text-text-primary text-lg">{formatEGP(placedOrderSummary?.grandTotal ?? 0)} EGP</span>
            </div>
          </motion.div>

          <motion.div
            className="flex flex-col gap-3 w-full max-w-xs"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.7 }}
          >
            <Link
              href={
                orderType !== "TABLE" && typeof window !== "undefined" && localStorage.getItem("ttc_vip_token")
                  ? `/vip/${localStorage.getItem("ttc_vip_token")}/track?sessionId=${sessionId}&slug=${restaurantSlug}&orderType=${orderType}&vipGuestId=${localStorage.getItem("ttc_vip_guestId") || ""}&vipName=${encodeURIComponent(localStorage.getItem("ttc_vip_name") || "VIP")}`
                  : `/track?table=${tableNumber}&restaurant=${restaurantSlug}${placedOrderId ? `&order=${placedOrderId}` : ""}${sessionId ? `&session=${sessionId}` : ""}${isSessionOwner ? "&checkout=1" : ""}`
              }
              className="w-full text-center py-3.5 rounded-2xl font-bold text-[15px] text-white bg-ocean-600 hover:bg-ocean-700 transition-colors"
            >
              {lang === "ar" ? "تتبع الطلب" : "Track Order"}
            </Link>
          </motion.div>
        </div>
      </PhoneFrame>
    );
  }

  // ─── Empty Cart ───────────────────────────────
  if (items.length === 0) {
    return (
      <PhoneFrame>
        <div className="h-full bg-gradient-to-b from-sand-50 to-white flex flex-col items-center justify-center px-6 text-center" dir={dir}>
          <motion.div
            className="w-20 h-20 rounded-full bg-sand-100 flex items-center justify-center mb-5"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", damping: 12 }}
          >
            <svg className="w-8 h-8 text-text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-5.98.572l-.003.022m5.983-.594h9.428a2.25 2.25 0 002.166-1.64l1.735-6.072A1.125 1.125 0 0019.736 5.25H6.763m.75 9h8.25m-8.25 0v.01M16.5 14.25v.01M9 21a1.125 1.125 0 100-2.25A1.125 1.125 0 009 21zm7.5 0a1.125 1.125 0 100-2.25 1.125 1.125 0 000 2.25z" />
            </svg>
          </motion.div>
          <h1 className="text-lg font-bold text-text-primary mb-2">Your cart is empty</h1>
          <p className="text-text-muted mb-6 max-w-xs text-sm font-light">
            Browse the menu and add something delicious
          </p>
          <Link
            href={menuUrl}
            className="px-8 py-3.5 rounded-2xl font-bold text-[15px] text-white bg-ocean-600 hover:bg-ocean-700 transition-colors"
          >
            Explore Menu
          </Link>
        </div>
      </PhoneFrame>
    );
  }

  // ─── Cart + Checkout ──────────────────────────
  return (
    <PhoneFrame>
      <CallWaiterButton />
      <JoinRequestOverlay />
      <div className="h-full bg-gradient-to-b from-sand-50 to-sand-100/50 overflow-y-auto pb-32" dir={dir}>
        {/* Header */}
        <div className="bg-white/80 backdrop-blur-xl sticky top-0 z-20 px-5 py-4 border-b border-sand-100/50 safe-top">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Link
                href={menuUrl}
                className="w-10 h-10 rounded-full bg-sand-100 flex items-center justify-center text-text-muted"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={dir === "rtl" ? "M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" : "M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"} />
                </svg>
              </Link>
              <div>
                <h1 className="text-lg font-semibold text-text-primary tracking-tight">{t("cart.title") || "Your Order"}</h1>
                <p className="text-[11px] text-text-muted font-medium flex items-center gap-1.5">
                  {items.length} item{items.length !== 1 ? "s" : ""} <GuestBadge />
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ChangeTableButton tableNumber={tableNumber} restaurant={restaurantSlug} />
              <LanguageToggle lang={lang} onToggle={toggleLang} />
              <Link
                href={menuUrl}
                className="px-3.5 py-2 rounded-full bg-sand-900 text-white text-[11px] font-bold"
              >
                + Add More
              </Link>
            </div>
          </div>
        </div>

        {/* Meal Progress */}
        <MealProgress items={cartMenuItems} />

        {/* Reinforcement Message */}
        <AnimatePresence>
          {reinforcement && (
            <motion.div
              className="mx-5 mt-3"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
            >
              <div className="px-4 py-3 rounded-xl bg-status-good-50 border border-status-good-100 flex items-center gap-2.5">
                <div className="w-5 h-5 rounded-full bg-status-good-500 flex items-center justify-center flex-shrink-0">
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
                <p className="text-xs text-status-good-700 font-semibold">{reinforcement}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Cart Items */}
        <div className="px-5 pt-4 space-y-3">
          <AnimatePresence mode="popLayout">
            {items.map((item) => {
              const addOnTotal = item.selectedAddOns.reduce((s, a) => s + a.price, 0);
              const lineTotal = (item.menuItem.price + addOnTotal) * item.quantity;
              const hasNotes = expandedNotes.has(item.menuItem.id) || !!item.notes;

              return (
                <motion.div
                  key={item.menuItem.id}
                  layout
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9, height: 0 }}
                  className="bg-white rounded-2xl overflow-hidden shadow-sm border border-sand-100"
                >
                  <div className="p-4 flex gap-3.5">
                    {/* Item image */}
                    <div className="w-[72px] h-[72px] rounded-xl flex-shrink-0 overflow-hidden ring-1 ring-black/5">
                      <div
                        className="w-full h-full bg-cover bg-center"
                        style={{ backgroundImage: `url(${resolveImage(item.menuItem.image)})` }}
                      />
                    </div>

                    <div className="flex-1 min-w-0">
                      {/* Name + Remove */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="font-bold text-text-primary text-[15px] truncate leading-tight">
                            {item.menuItem.name}
                          </h3>
                          {item.selectedAddOns.length > 0 && (
                            <p className="text-[11px] text-text-muted truncate mt-0.5">
                              + {item.selectedAddOns.map((a) => a.name).join(", ")}
                            </p>
                          )}
                          {item.wasUpsell && (
                            <span className="inline-block text-[10px] text-ocean-600 bg-ocean-50 px-2 py-0.5 rounded-full mt-1 font-semibold">
                              Chef Suggested
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => removeItem(item.menuItem.id)}
                          className="text-text-muted hover:text-text-secondary transition-colors p-1 -mr-1 -mt-0.5 flex-shrink-0"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>

                      {/* Quantity + Price */}
                      <div className="flex items-center justify-between mt-3">
                        <div className="flex items-center gap-0.5 bg-sand-100 rounded-full p-0.5">
                          <motion.button
                            onClick={() => updateQuantity(item.menuItem.id, item.quantity - 1)}
                            className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-text-secondary text-sm font-medium shadow-sm"
                            whileTap={{ scale: 0.9 }}
                          >
                            -
                          </motion.button>
                          <motion.span
                            key={item.quantity}
                            className="font-bold text-text-primary w-8 text-center text-sm"
                            initial={{ scale: 1.3 }}
                            animate={{ scale: 1 }}
                          >
                            {item.quantity}
                          </motion.span>
                          <motion.button
                            onClick={() => updateQuantity(item.menuItem.id, item.quantity + 1)}
                            className="w-8 h-8 rounded-full bg-white flex items-center justify-center text-text-secondary text-sm font-medium shadow-sm"
                            whileTap={{ scale: 0.9 }}
                          >
                            +
                          </motion.button>
                        </div>
                        <motion.span
                          key={lineTotal}
                          className="font-semibold text-text-primary text-[15px] tabular-nums"
                          initial={{ opacity: 0.5 }}
                          animate={{ opacity: 1 }}
                        >
                          {formatEGP(lineTotal)} <span className="text-xs font-semibold text-text-muted">EGP</span>
                        </motion.span>
                      </div>
                    </div>
                  </div>

                  {/* Notes section */}
                  <AnimatePresence>
                    {hasNotes ? (
                      <motion.div
                        className="px-4 pb-3"
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                      >
                        <input
                          type="text"
                          placeholder={lang === "ar" ? "ملاحظات خاصة..." : "Special instructions..."}
                          value={item.notes || ""}
                          onChange={(e) => updateNotes(item.menuItem.id, e.target.value)}
                          className="w-full px-3.5 py-2.5 rounded-xl border border-sand-100 bg-sand-50 text-xs text-text-secondary placeholder:text-text-muted focus:border-ocean-200 focus:bg-white focus:outline-none transition-all"
                        />
                      </motion.div>
                    ) : (
                      <motion.button
                        className="px-4 pb-3 text-[11px] text-text-muted font-medium flex items-center gap-1"
                        onClick={() => setExpandedNotes(prev => new Set(prev).add(item.menuItem.id))}
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                        </svg>
                        {lang === "ar" ? "أضف ملاحظة" : "Add note"}
                      </motion.button>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Suggestions + Bundles */}
        <SuggestionCards
          suggestions={suggestions}
          bundles={bundles}
          onAddItem={handleAddSuggestion}
        />

        {/* Session orders: what others at this table already ordered */}
        {sessionOrders.length > 0 && (
          <div className="mx-5 mt-5">
            <div className="bg-ocean-50/60 rounded-2xl p-4 border border-ocean-100">
              <h3 className="text-[11px] font-bold text-ocean-600 mb-2.5 flex items-center gap-1.5 uppercase tracking-widest">
                Already ordered at this table
              </h3>
              <div className="space-y-1.5">
                {sessionOrders.flatMap((order) =>
                  order.items.map((item, i) => (
                    <div key={`${order.id}-${i}`} className="flex justify-between text-xs">
                      <span className="text-text-secondary">
                        <span className="font-semibold text-text-secondary">{item.quantity}x</span>{" "}
                        {item.name}
                      </span>
                      <span className="text-text-muted tabular-nums">{formatEGP(item.price * item.quantity)} EGP</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* Delivery Payment Method */}
        {isDelivery && (
          <div className="mx-5 mt-5">
            <div className="bg-white rounded-2xl p-5 shadow-sm border border-sand-100">
              <p className="text-[11px] font-bold text-text-muted uppercase tracking-widest mb-3">Payment Method</p>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { key: "CASH", label: "Cash", icon: "\uD83D\uDCB5" },
                  { key: "CARD", label: "Card", icon: "\uD83D\uDCB3" },
                  { key: "INSTAPAY", label: "InstaPay", icon: "\u26A1" },
                ].map((m) => (
                  <button
                    key={m.key}
                    onClick={() => setPaymentMethod(paymentMethod === m.key ? null : m.key)}
                    className={`flex flex-col items-center gap-1 py-3 rounded-xl border-2 transition active:scale-95 ${
                      paymentMethod === m.key
                        ? "border-ocean-500 bg-ocean-50"
                        : "border-sand-200"
                    }`}
                  >
                    <span className="text-xl">{m.icon}</span>
                    <span className={`text-[11px] font-bold ${paymentMethod === m.key ? "text-ocean-700" : "text-text-secondary"}`}>{m.label}</span>
                  </button>
                ))}
              </div>
              {!paymentMethod && (
                <p className="text-[10px] text-status-warn-600 font-semibold mt-2 text-center">Select a payment method to place your order</p>
              )}
              {!deliveryAddress && (
                <p className="text-[10px] text-coral-600 font-semibold mt-2 text-center">Go back and enter your delivery address first</p>
              )}
            </div>
          </div>
        )}

        {/* Order Summary */}
        <div className="mx-5 mt-5">
          <div className="bg-white rounded-2xl p-5 shadow-sm border border-sand-100">
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-text-muted font-medium">
                  Subtotal ({items.reduce((s, i) => s + i.quantity, 0)} items)
                </span>
                <span className="text-text-secondary font-semibold tabular-nums">{formatEGP(total)} EGP</span>
              </div>
              {isDelivery && (
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted font-medium">Delivery fee</span>
                  <span className="text-text-secondary font-semibold tabular-nums">{formatEGP(DELIVERY_FEE)} EGP</span>
                </div>
              )}
              <div className="border-t border-sand-100 pt-3 flex justify-between items-center">
                <span className="font-bold text-text-primary">Total</span>
                <motion.span
                  key={grandTotal}
                  className="font-semibold text-xl text-text-primary tabular-nums"
                  initial={{ y: -5, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                >
                  {formatEGP(grandTotal + (isDelivery ? DELIVERY_FEE : 0))} <span className="text-sm font-semibold text-text-muted">EGP</span>
                </motion.span>
              </div>
            </div>
          </div>
        </div>

        {/* Trust signals */}
        <div className="flex items-center justify-center gap-5 mt-4 mb-4">
          <span className="flex items-center gap-1.5 text-[10px] text-text-muted font-medium">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
            Secure
          </span>
          <span className="flex items-center gap-1.5 text-[10px] text-text-muted font-medium">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
            </svg>
            Instant
          </span>
          <span className="flex items-center gap-1.5 text-[10px] text-text-muted font-medium">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            No hidden fees
          </span>
        </div>

        {/* Error Display */}
        <AnimatePresence>
          {orderError && (
            <motion.div
              className="mx-5 mb-3"
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 5 }}
            >
              <div className="p-4 rounded-2xl bg-status-bad-50 border border-status-bad-200">
                <p className="text-sm font-semibold text-status-bad-800 mb-3">{orderError}</p>
                <div className="flex gap-2">
                  <button
                    onClick={handlePlaceOrder}
                    className="flex-1 py-2.5 rounded-xl bg-status-bad-600 text-white text-sm font-bold"
                  >
                    Try Again
                  </button>
                  <button
                    onClick={() => setOrderError(null)}
                    className="px-4 py-2.5 rounded-xl border border-status-bad-300 text-status-bad-700 text-sm font-semibold"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Urgency nudge */}
        {canOrder && (
          <div className="px-5 mb-2">
            <p className="text-center text-[11px] text-text-muted font-medium">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-status-good-400 animate-pulse" />
                Kitchen is ready — orders being prepared quickly
              </span>
            </p>
          </div>
        )}

        {/* Place Order Button — Sticky */}
        <div className="sticky bottom-0 left-0 right-0 p-4 safe-bottom bg-gradient-to-t from-sand-50 via-sand-50/95 to-transparent z-30 pt-6">
          <motion.button
            onClick={handlePlaceOrder}
            disabled={!canOrder || isSubmitting}
            className={`w-full text-center py-4 rounded-2xl font-bold text-[15px] transition-all relative overflow-hidden ${
              canOrder && !isSubmitting
                ? "bg-ocean-600 hover:bg-ocean-700 text-white shadow-xl shadow-ocean-500/20"
                : "bg-sand-200 text-text-muted cursor-not-allowed"
            }`}
            whileTap={canOrder && !isSubmitting ? { scale: 0.98 } : {}}
          >
            {isSubmitting ? (
              <span className="flex items-center justify-center gap-2">
                <motion.span
                  className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full"
                  animate={{ rotate: 360 }}
                  transition={{ repeat: Infinity, duration: 0.7, ease: "linear" }}
                />
                Processing...
              </span>
            ) : (
              <span className="relative z-10">{t("cart.sendOrder")} — {formatEGP(grandTotal + (isDelivery ? DELIVERY_FEE : 0))} {t("common.egp")}</span>
            )}
            {canOrder && !isSubmitting && (
              <motion.div
                className="absolute inset-0 opacity-20"
                style={{ background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)" }}
                animate={{ x: ["-100%", "200%"] }}
                transition={{ repeat: Infinity, duration: 3, ease: "easeInOut", repeatDelay: 2 }}
              />
            )}
          </motion.button>

          {items.length > 0 && !isSessionOwner && (
            <p className="text-center text-[11px] text-text-muted mt-2.5">
              {t("cart.paymentByFirst")}
            </p>
          )}
          {items.length > 0 && isSessionOwner && (
            <p className="text-center text-[11px] text-text-muted mt-2.5">
              You can pay for the entire table after placing your order
            </p>
          )}
        </div>
      </div>

      {/* Drop-off Recovery Overlay */}
      <AnimatePresence>
        {showDropOff && !dropOffDismissed && (
          <DropOffRecovery
            show={showDropOff}
            onAddItem={handleAddSuggestion}
            onDismiss={() => {
              setShowDropOff(false);
              setDropOffDismissed(true);
            }}
          />
        )}
      </AnimatePresence>
    </PhoneFrame>
  );
}
