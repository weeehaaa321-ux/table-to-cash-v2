import type { Identifier } from "../shared/Identifier";
import type { Lang } from "../shared/Lang";
import { TimeOfDayWindow } from "../shared/TimeOfDayWindow";

export type CategoryId = Identifier<"Category">;

/**
 * Station — where the order goes when received. Source repo: enum Station
 * in schema.prisma. Bar items skip the kitchen screen; kitchen items skip
 * the bar screen.
 */
export type Station = "KITCHEN" | "BAR" | "ACTIVITY";

/**
 * Category groups menu items. Carries:
 *  - sort order (used in guest menu rendering)
 *  - icon (display)
 *  - station (routes orders to KITCHEN or BAR display)
 *  - time-of-day window (e.g. breakfast 7–11)
 *  - translations: name/nameAr/nameRu (domain content i18n)
 */
export class Category {
  private constructor(
    public readonly id: CategoryId,
    public readonly slug: string,
    public readonly station: Station,
    public readonly sortOrder: number,
    public readonly availability: TimeOfDayWindow,
    public readonly icon: string | null,
    private readonly nameByLang: { en: string; ar: string | null; ru: string | null },
  ) {}

  static rehydrate(props: {
    id: CategoryId;
    slug: string;
    name: string;
    nameAr: string | null;
    nameRu: string | null;
    station: Station;
    sortOrder: number;
    icon: string | null;
    availableFromHour: number | null;
    availableToHour: number | null;
  }): Category {
    return new Category(
      props.id,
      props.slug,
      props.station,
      props.sortOrder,
      TimeOfDayWindow.of(props.availableFromHour, props.availableToHour),
      props.icon,
      { en: props.name, ar: props.nameAr, ru: props.nameRu },
    );
  }

  /**
   * Translation lookup. Falls back to English if the requested language
   * doesn't have a value (matches source repo i18n behavior).
   */
  nameIn(lang: Lang): string {
    const v = this.nameByLang[lang];
    return v ?? this.nameByLang.en;
  }

  /**
   * Whether this category is currently visible at the given hour-of-day
   * in the restaurant's local timezone.
   */
  isAvailableAt(hourOfDay: number): boolean {
    return this.availability.includes(hourOfDay);
  }

  /** Direct access to this category's time-of-day window (used by item visibility checks). */
  getAvailability(): TimeOfDayWindow {
    return this.availability;
  }
}
