"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RESTAURANT_SLUG } from "@/lib/restaurant-config";
import { useLanguage } from "@/lib/use-language";

// Minimum in-service menu control for the floor manager:
//   - See everything grouped by category (search across all)
//   - One-tap toggle an item's availability (out of stock ↔ back)
//   - Count of items currently offline at the panel header
// Owner-level edits (prices, descriptions, photos) stay on the dashboard;
// this panel is what the floor mgr needs during service.

type MenuItem = {
  id: string;
  name: string;
  nameAr?: string | null;
  price: number;
  available: boolean;
};

type MenuCategory = {
  id: string;
  name: string;
  nameAr?: string | null;
  items: MenuItem[];
};

export function MenuControlPanel() {
  const { t, lang } = useLanguage();
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/menu-admin?restaurantId=${RESTAURANT_SLUG}`);
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories || []);
      }
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (item: MenuItem) => {
    if (pendingId) return;
    setPendingId(item.id);
    // Optimistic flip.
    setCategories((prev) => prev.map((c) => ({
      ...c,
      items: c.items.map((it) => it.id === item.id ? { ...it, available: !it.available } : it),
    })));
    try {
      const res = await fetch("/api/menu-admin", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: item.id, available: !item.available }),
      });
      if (!res.ok) {
        // Rollback.
        setCategories((prev) => prev.map((c) => ({
          ...c,
          items: c.items.map((it) => it.id === item.id ? { ...it, available: item.available } : it),
        })));
      }
    } catch {
      setCategories((prev) => prev.map((c) => ({
        ...c,
        items: c.items.map((it) => it.id === item.id ? { ...it, available: item.available } : it),
      })));
    }
    setPendingId(null);
  };

  const allItems = useMemo(() => categories.flatMap((c) => c.items.map((it) => ({ item: it, category: c }))), [categories]);
  const offlineCount = allItems.filter(({ item }) => !item.available).length;

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return categories;
    return categories
      .map((c) => ({ ...c, items: c.items.filter((it) => (it.name + " " + (it.nameAr || "")).toLowerCase().includes(q)) }))
      .filter((c) => c.items.length > 0);
  }, [categories, q]);

  const displayName = (x: { name: string; nameAr?: string | null }) => (lang === "ar" && x.nameAr) ? x.nameAr : x.name;

  return (
    <div className="rounded-2xl bg-white border border-sand-200">
      <button onClick={() => setExpanded((v) => !v)}
        className="w-full px-4 py-3 border-b border-sand-100 flex items-center justify-between text-left">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted">{t("floor.menuControl")}</p>
          <p className="text-[10px] text-text-secondary tabular-nums mt-0.5">
            {loading ? "…" : offlineCount > 0
              ? `${offlineCount} ${t("floor.itemsOffline")}`
              : `${allItems.length} ${t("floor.itemsAllAvailable")}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {offlineCount > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-status-bad-100 text-status-bad-700 text-[10px] font-semibold tabular-nums">{offlineCount}</span>
          )}
          <span className="text-text-muted text-base">{expanded ? "▾" : "▸"}</span>
        </div>
      </button>

      {expanded && (
        <div className="p-3 space-y-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("floor.searchMenu")}
            className="w-full h-10 px-3 rounded-lg bg-sand-50 border border-sand-200 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-ocean-400"
          />

          {loading && <p className="text-[11px] text-text-muted text-center py-4">{t("floor.loading")}</p>}

          {!loading && filtered.length === 0 && (
            <p className="text-[11px] text-text-muted text-center py-4">{t("floor.noMenuMatch")}</p>
          )}

          <div className="space-y-3">
            {filtered.map((c) => (
              <div key={c.id}>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-text-muted mb-1.5">
                  {displayName(c)}
                </p>
                <div className="space-y-1">
                  {c.items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => toggle(item)}
                      disabled={pendingId === item.id}
                      className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left transition active:scale-[0.99] ${
                        item.available
                          ? "bg-white border-sand-200 hover:bg-sand-50"
                          : "bg-status-bad-50 border-status-bad-200 hover:bg-status-bad-100"
                      } ${pendingId === item.id ? "opacity-60" : ""}`}
                    >
                      <span
                        className={`inline-flex items-center justify-center w-9 h-5 rounded-full transition ${
                          item.available ? "bg-status-good-500" : "bg-status-bad-400"
                        }`}
                        aria-hidden
                      >
                        <span
                          className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${
                            item.available ? "translate-x-2" : "-translate-x-2"
                          }`}
                        />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className={`text-[12px] font-bold truncate ${item.available ? "text-text-primary" : "text-text-secondary"}`}>
                          {displayName(item)}
                        </p>
                        <p className={`text-[10px] tabular-nums ${item.available ? "text-text-muted" : "text-status-bad-500"}`}>
                          {item.price.toLocaleString()} {t("common.egp")}
                          {!item.available && ` · ${t("floor.outOfStock")}`}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
