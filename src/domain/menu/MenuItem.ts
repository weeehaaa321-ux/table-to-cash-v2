import type { Identifier } from "../shared/Identifier";
import type { Lang } from "../shared/Lang";
import { Money } from "../shared/Money";
import { TimeOfDayWindow } from "../shared/TimeOfDayWindow";
import type { CategoryId } from "./Category";

export type MenuItemId = Identifier<"MenuItem">;

/**
 * MenuItem — a single sellable thing on the menu. Belongs to a Category.
 * Carries content translations (en/ar/ru), a price (Money), tags, and
 * its own time-of-day window which combines with the category's window.
 */
export class MenuItem {
  private constructor(
    public readonly id: MenuItemId,
    public readonly categoryId: CategoryId,
    public readonly price: Money,
    public readonly available: boolean,
    public readonly bestSeller: boolean,
    public readonly highMargin: boolean,
    public readonly calories: number | null,
    public readonly prepTimeMinutes: number | null,
    public readonly sortOrder: number,
    public readonly image: string | null,
    public readonly tags: readonly string[],
    public readonly pairsWith: readonly MenuItemId[],
    public readonly views: number,
    private readonly availability: TimeOfDayWindow,
    private readonly nameByLang: { en: string; ar: string | null; ru: string | null },
    private readonly descByLang: { en: string | null; ar: string | null; ru: string | null },
  ) {}

  static rehydrate(props: {
    id: MenuItemId;
    categoryId: CategoryId;
    name: string;
    nameAr: string | null;
    nameRu: string | null;
    description: string | null;
    descAr: string | null;
    descRu: string | null;
    price: Money;
    image: string | null;
    available: boolean;
    bestSeller: boolean;
    highMargin: boolean;
    calories: number | null;
    prepTime: number | null;
    sortOrder: number;
    availableFromHour: number | null;
    availableToHour: number | null;
    tags: readonly string[];
    pairsWith: readonly MenuItemId[];
    views: number;
  }): MenuItem {
    return new MenuItem(
      props.id,
      props.categoryId,
      props.price,
      props.available,
      props.bestSeller,
      props.highMargin,
      props.calories,
      props.prepTime,
      props.sortOrder,
      props.image,
      props.tags,
      props.pairsWith,
      props.views,
      TimeOfDayWindow.of(props.availableFromHour, props.availableToHour),
      { en: props.name, ar: props.nameAr, ru: props.nameRu },
      { en: props.description, ar: props.descAr, ru: props.descRu },
    );
  }

  nameIn(lang: Lang): string {
    return this.nameByLang[lang] ?? this.nameByLang.en;
  }

  descIn(lang: Lang): string {
    return this.descByLang[lang] ?? this.descByLang.en ?? "";
  }

  /**
   * Whether this item should be visible to a guest right now.
   * Combines: explicit `available` flag, item's own time window, and
   * the category's time window. The category window is intersected
   * by the caller via `isVisibleAt(hour, categoryWindow)`.
   */
  isVisibleAt(hourOfDay: number, categoryWindow: TimeOfDayWindow): boolean {
    if (!this.available) return false;
    return this.availability.includesUnderBoth(categoryWindow, hourOfDay);
  }

  hasTag(tag: string): boolean {
    return this.tags.includes(tag);
  }
}
