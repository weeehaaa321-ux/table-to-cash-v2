"use client";

import { create } from "zustand";
import type { CartItem, MenuItem, AddOn } from "@/types/menu";

type CartStore = {
  items: CartItem[];
  tableId: string | null;
  restaurantId: string | null;
  sessionId: string | null;
  isSessionOwner: boolean;
  guestNumber: number;
  guestName: string | null;
  hasPaymentAuthority: boolean;
  language: string;
  orderType: "TABLE" | "VIP_DINE_IN" | "DELIVERY";
  vipGuestId: string | null;
  vipGuestName: string | null;
  deliveryAddress: string | null;
  deliveryNotes: string | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
  paymentMethod: string | null;

  setTable: (tableId: string, restaurantId: string) => void;
  setSessionId: (sessionId: string) => void;
  setIsSessionOwner: (isOwner: boolean) => void;
  setGuestNumber: (n: number) => void;
  setGuestName: (name: string | null) => void;
  setHasPaymentAuthority: (has: boolean) => void;
  setLanguage: (lang: string) => void;
  setOrderType: (type: "TABLE" | "VIP_DINE_IN" | "DELIVERY") => void;
  setVipGuest: (id: string, name: string) => void;
  setDeliveryInfo: (address: string, notes: string, lat: number | null, lng: number | null) => void;
  setPaymentMethod: (method: string | null) => void;
  addItem: (menuItem: MenuItem, addOns?: AddOn[], wasUpsell?: boolean, quantity?: number) => void;
  removeItem: (menuItemId: string) => void;
  updateQuantity: (menuItemId: string, quantity: number) => void;
  updateNotes: (menuItemId: string, notes: string) => void;
  clearCart: () => void;

  totalItems: () => number;
  subtotal: () => number;
  itemIds: () => string[];
};

// Hydrate persisted session state.
//
// sessionId, owner flag, guestNumber and guestName all live in
// localStorage scoped by sessionId — same browser scanning the same
// QR (or opening a 2nd tab) walks back into the exact same identity
// they had before. Per-tab sessionStorage was the previous home for
// the owner flag, but it punished the common "guest closed the tab,
// reopened it" path with a fresh join request and a lost identity.
// Session-scoping the keys (e.g. ttc_owner_<sid>) means a brand-new
// session on a different table still gets a clean slate.
function getPersistedSession(): { sessionId: string | null; isSessionOwner: boolean } {
  if (typeof window === "undefined") return { sessionId: null, isSessionOwner: false };
  try {
    const sessionId = localStorage.getItem("ttc_sessionId") || sessionStorage.getItem("ttc_sessionId") || null;
    const isOwner = sessionId ? localStorage.getItem(`ttc_owner_${sessionId}`) === "1" : false;
    return { sessionId, isSessionOwner: isOwner };
  } catch { return { sessionId: null, isSessionOwner: false }; }
}

export const useCart = create<CartStore>((set, get) => ({
  items: [],
  tableId: null,
  restaurantId: null,
  sessionId: getPersistedSession().sessionId,
  isSessionOwner: getPersistedSession().isSessionOwner,
  guestNumber: (() => {
    if (typeof window === "undefined") return 0;
    try {
      const sid = localStorage.getItem("ttc_sessionId") || sessionStorage.getItem("ttc_sessionId");
      if (!sid) return 0;
      const v = parseInt(localStorage.getItem(`ttc_guestNumber_${sid}`) || "0", 10);
      return Number.isFinite(v) ? v : 0;
    } catch { return 0; }
  })(),
  guestName: (() => {
    if (typeof window === "undefined") return null;
    try {
      const sid = localStorage.getItem("ttc_sessionId") || sessionStorage.getItem("ttc_sessionId");
      if (!sid) return null;
      // Session-scoped key so a name from a past table doesn't leak
      // into a brand-new session when the same browser scans a
      // different QR.
      return localStorage.getItem(`ttc_guestName_${sid}`) || null;
    } catch { return null; }
  })(),
  hasPaymentAuthority: false,
  language: "en",
  orderType: "TABLE",
  vipGuestId: null,
  vipGuestName: null,
  deliveryAddress: null,
  deliveryNotes: null,
  deliveryLat: null,
  deliveryLng: null,
  paymentMethod: null,

  setTable: (tableId, restaurantId) => set({ tableId, restaurantId }),
  setSessionId: (sessionId) => {
    set({ sessionId });
    if (typeof window !== "undefined") try {
      sessionStorage.setItem("ttc_sessionId", sessionId);
      localStorage.setItem("ttc_sessionId", sessionId);
    } catch {}
  },
  setIsSessionOwner: (isSessionOwner) => {
    set({ isSessionOwner });
    if (typeof window !== "undefined") try {
      const sid = get().sessionId;
      if (sid) localStorage.setItem(`ttc_owner_${sid}`, isSessionOwner ? "1" : "0");
    } catch {}
  },
  setGuestNumber: (guestNumber) => {
    set({ guestNumber });
    if (typeof window !== "undefined") try {
      const sid = get().sessionId;
      if (sid) localStorage.setItem(`ttc_guestNumber_${sid}`, String(guestNumber));
    } catch {}
  },
  setGuestName: (guestName) => {
    // Trim and cap at 30 chars so the receipt thermal-printer width
    // and floor-manager card layout stay consistent. Empty/whitespace
    // becomes null which makes downstream UIs fall back to "Guest #N".
    const cleaned = guestName ? guestName.trim().slice(0, 30) : "";
    const next = cleaned.length > 0 ? cleaned : null;
    set({ guestName: next });
    if (typeof window !== "undefined") try {
      const sid = get().sessionId;
      if (sid) {
        if (next) localStorage.setItem(`ttc_guestName_${sid}`, next);
        else localStorage.removeItem(`ttc_guestName_${sid}`);
      }
    } catch {}
  },
  setHasPaymentAuthority: (hasPaymentAuthority) => set({ hasPaymentAuthority }),
  setLanguage: (language) => set({ language }),
  setOrderType: (orderType) => set({ orderType }),
  setVipGuest: (id, name) => set({ vipGuestId: id, vipGuestName: name }),
  setDeliveryInfo: (deliveryAddress, deliveryNotes, deliveryLat, deliveryLng) =>
    set({ deliveryAddress, deliveryNotes, deliveryLat, deliveryLng }),
  setPaymentMethod: (paymentMethod) => set({ paymentMethod }),

  addItem: (menuItem, addOns = [], wasUpsell = false, quantity = 1) => {
    const items = get().items;
    const existing = items.find((i) => i.menuItem.id === menuItem.id);
    // Hourly activities (kayak / board / massage) use the hour picker
    // on the menu sheet; the picked count comes through here as
    // `quantity`. For non-hourly items the caller passes 1 (the
    // default). Either way, an existing line REPLACES its quantity
    // when an explicit count is supplied — that matches the UX of
    // re-opening the picker and choosing a new value, rather than
    // stacking on top.
    const qty = Math.max(1, Math.floor(quantity));

    // Haptic feedback
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(10);
    }

    if (existing) {
      set({
        items: items.map((i) =>
          i.menuItem.id === menuItem.id
            ? { ...i, quantity: qty > 1 ? qty : i.quantity + 1 }
            : i
        ),
      });
    } else {
      set({
        items: [
          ...items,
          { menuItem, quantity: qty, selectedAddOns: addOns, wasUpsell },
        ],
      });
    }
  },

  removeItem: (menuItemId) => {
    set({ items: get().items.filter((i) => i.menuItem.id !== menuItemId) });
  },

  updateQuantity: (menuItemId, quantity) => {
    if (quantity <= 0) {
      get().removeItem(menuItemId);
      return;
    }
    set({
      items: get().items.map((i) =>
        i.menuItem.id === menuItemId ? { ...i, quantity } : i
      ),
    });
  },

  updateNotes: (menuItemId, notes) => {
    set({
      items: get().items.map((i) =>
        i.menuItem.id === menuItemId ? { ...i, notes } : i
      ),
    });
  },

  clearCart: () => set((state) => ({ items: [], sessionId: state.sessionId })),

  totalItems: () => get().items.reduce((sum, i) => sum + i.quantity, 0),

  subtotal: () =>
    get().items.reduce((sum, item) => {
      const addOnTotal = item.selectedAddOns.reduce(
        (a, addon) => a + addon.price,
        0
      );
      return sum + (item.menuItem.price + addOnTotal) * item.quantity;
    }, 0),

  itemIds: () => get().items.map((i) => i.menuItem.id),
}));
