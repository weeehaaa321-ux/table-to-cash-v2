"use client";

import { create } from "zustand";
import type { Category, MenuItem } from "@/types/menu";

type MenuStore = {
  categories: Category[];
  allItems: MenuItem[];
  activeStations: string[];
  restaurantId: string | null;
  restaurantSlug: string | null;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  lastRefresh: number;

  initialize: (restaurantSlug?: string) => Promise<void>;
  refresh: () => Promise<void>;
};

export const useMenu = create<MenuStore>((set, get) => ({
  categories: [],
  allItems: [],
  activeStations: ["KITCHEN", "BAR"],
  restaurantId: null,
  restaurantSlug: null,
  loaded: false,
  loading: false,
  error: null,
  lastRefresh: 0,

  refresh: async () => {
    const state = get();
    if (!state.loaded || state.loading || !state.restaurantId) return;
    try {
      const menuRes = await fetch(`/api/menu/${state.restaurantId}`);
      if (!menuRes.ok) return;
      const menuData = await menuRes.json();
      const categories: Category[] = menuData.categories || menuData;
      const activeStations: string[] = menuData.activeStations || ["KITCHEN", "BAR"];
      const allItems = categories.flatMap((c) => c.items);
      set({ categories, allItems, activeStations, lastRefresh: Date.now() });
    } catch { /* silent */ }
  },

  initialize: async (slug?: string) => {
    const state = get();
    if (state.loaded || state.loading) return;

    set({ loading: true, error: null });

    // Resolve restaurant and fetch menu from API
    const restaurantSlug =
      slug ||
      process.env.NEXT_PUBLIC_RESTAURANT_SLUG ||
      "neom-dahab";

    try {
      // Resolve slug to restaurant ID
      const resRes = await fetch(`/api/restaurant?slug=${restaurantSlug}`);
      if (!resRes.ok) {
        const body = await resRes.json().catch(() => ({}));
        throw new Error(body.detail || body.error || `Restaurant API returned ${resRes.status}`);
      }
      const restaurant = await resRes.json();
      const restaurantId = restaurant.id;

      // Fetch menu
      const menuRes = await fetch(`/api/menu/${restaurantId}`);
      if (!menuRes.ok) throw new Error("Failed to load menu");
      const menuData = await menuRes.json();
      const categories: Category[] = menuData.categories || menuData;
      const activeStations: string[] = menuData.activeStations || ["KITCHEN", "BAR"];
      const allItems = categories.flatMap((c) => c.items);

      set({
        categories,
        allItems,
        activeStations,
        restaurantId,
        restaurantSlug,
        loaded: true,
        loading: false,
        lastRefresh: Date.now(),
      });
    } catch (err) {
      console.error("Menu initialization failed:", err);
      set({
        error: err instanceof Error ? err.message : "Failed to load menu",
        loading: false,
      });
    }
  },
}));
