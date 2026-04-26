import type { Category } from "@/domain/menu/Category";
import type { MenuItem } from "@/domain/menu/MenuItem";
import type { AddOn } from "@/domain/menu/AddOn";

/**
 * Read + admin operations for the menu. Single port covers all menu
 * concerns rather than splitting by entity — they're tightly coupled
 * (you almost always want a category with its items, etc.).
 *
 * All methods are scoped to the current restaurant (no `restaurantId`
 * parameter): per docs/INVENTORY.md §14 Q4, this is single-tenant per
 * deploy. Implementations read RESTAURANT_SLUG from
 * infrastructure/config/env.
 */
export interface MenuRepository {
  /**
   * Full menu read for the guest /menu page. Returns all categories
   * (ordered by sortOrder) with their items (also ordered).
   * Items are NOT filtered by time-of-day — the caller decides
   * (e.g. presentation may want to grey-out unavailable items rather
   * than hide them).
   */
  fetchFullMenu(): Promise<{
    categories: readonly Category[];
    itemsByCategory: ReadonlyMap<string, readonly MenuItem[]>;
    addOnsByItem: ReadonlyMap<string, readonly AddOn[]>;
  }>;

  /** Single item by id, or null if not found. */
  findItemById(id: string): Promise<MenuItem | null>;

  /** Single category by id, or null if not found. */
  findCategoryById(id: string): Promise<Category | null>;

  /** Increment view counter for an item (used by guest page on item open). */
  incrementItemViews(itemId: string, by?: number): Promise<void>;
}
