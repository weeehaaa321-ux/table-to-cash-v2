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
            isVisibleNow: item.isVisibleAt(hour, category.getAvailability()),
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
