import type { MenuRepository } from "../ports/MenuRepository";
import type { Clock } from "../ports/Clock";
import type { Lang } from "@/domain/shared/Lang";
import type { Category } from "@/domain/menu/Category";
import type { MenuItem } from "@/domain/menu/MenuItem";
import type { AddOn } from "@/domain/menu/AddOn";

/**
 * BrowseMenuUseCase — assembles the guest-facing menu read.
 *
 * Source repo: GET /api/menu route handler. Pulls the full menu,
 * applies time-of-day visibility (using the clock for current hour
 * in restaurant timezone), and returns a presentation-friendly shape.
 *
 * `lang` is taken from a query param / cookie in the route handler
 * and passed in here. The use case stays language-agnostic — it just
 * forwards.
 */
export class BrowseMenuUseCase {
  constructor(
    private readonly menu: MenuRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: { lang: Lang; includeUnavailable?: boolean }): Promise<{
    categories: ReadonlyArray<{
      category: Category;
      items: ReadonlyArray<{ item: MenuItem; addOns: readonly AddOn[]; isVisibleNow: boolean }>;
    }>;
  }> {
    const { categories, itemsByCategory, addOnsByItem } = await this.menu.fetchFullMenu();
    const hour = this.clock.nowInRestaurantTz().getHours();

    const out = categories
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((category) => {
        const items = (itemsByCategory.get(category.id) ?? [])
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((item) => ({
            item,
            addOns: addOnsByItem.get(item.id) ?? [],
            isVisibleNow: item.isVisibleAt(hour, asWindow(category)),
          }));
        return { category, items };
      });

    if (input.includeUnavailable) return { categories: out };

    // Filter to visible-now items + categories that have at least one
    // visible item.
    const filtered = out
      .map((c) => ({
        ...c,
        items: c.items.filter((i) => i.isVisibleNow),
      }))
      .filter((c) => c.items.length > 0);

    return { categories: filtered };
  }
}

// Helper: extract a Category's TimeOfDayWindow without exposing the
// internals on the entity. The Category exposes `isAvailableAt(hour)`
// directly, but MenuItem.isVisibleAt needs the window object — so
// reconstruct it from the category's own check by probing.
//
// We could expose a `.window` getter on Category. For now, a
// minimal-impact helper keeps the Category surface tight and
// keeps MenuItem.isVisibleAt's type signature unchanged.
function asWindow(category: Category) {
  // 24-hour probe builds a window-like object whose includes() returns
  // category.isAvailableAt(h). Used only in this file.
  return {
    includes(h: number): boolean {
      return category.isAvailableAt(h);
    },
    includesUnderBoth(other: { includes(h: number): boolean }, h: number): boolean {
      return this.includes(h) && other.includes(h);
    },
    isAlways(): boolean {
      return this.includes(0) && this.includes(12);
    },
    getFromHour(): number | null {
      return null;
    },
    getToHour(): number | null {
      return null;
    },
  };
}
