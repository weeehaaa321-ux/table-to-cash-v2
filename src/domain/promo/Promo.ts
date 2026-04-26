import type { Identifier } from "../shared/Identifier";
import { Money } from "../shared/Money";

export type PromoId = Identifier<"Promo">;
export type PromoType = "PERCENTAGE" | "FIXED" | "BUNDLE" | "HAPPY_HOUR";

/**
 * Promo — a discount or special offer. The `value` semantics depend on
 * `type`:
 *   PERCENTAGE   value = 0–100 (percent off)
 *   FIXED        value = currency amount off (Decimal)
 *   BUNDLE       value = bundle-specific price for items in `itemIds`
 *   HAPPY_HOUR   value = percent off applied within startHour..endHour
 *
 * Promos are evaluated when the cart total is computed. Application
 * layer holds the orchestration; this entity is mostly a data container
 * + small predicates.
 */
export class Promo {
  private constructor(
    public readonly id: PromoId,
    public readonly title: string,
    public readonly description: string | null,
    public readonly type: PromoType,
    public readonly value: number, // raw decimal value; meaning depends on type
    public readonly startHour: number | null,
    public readonly endHour: number | null,
    public readonly active: boolean,
    public readonly itemIds: readonly string[],
    public readonly createdAt: Date,
  ) {}

  static rehydrate(props: {
    id: PromoId;
    title: string;
    description: string | null;
    type: PromoType;
    value: number;
    startHour: number | null;
    endHour: number | null;
    active: boolean;
    itemIds: readonly string[];
    createdAt: Date;
  }): Promo {
    return new Promo(
      props.id,
      props.title,
      props.description,
      props.type,
      props.value,
      props.startHour,
      props.endHour,
      props.active,
      props.itemIds,
      props.createdAt,
    );
  }

  /**
   * Whether this promo is active right now at the given hour.
   * HAPPY_HOUR also requires the hour to fall within startHour..endHour.
   */
  isActiveAt(hourOfDay: number): boolean {
    if (!this.active) return false;
    if (this.type !== "HAPPY_HOUR") return true;
    if (this.startHour === null || this.endHour === null) return true;
    if (this.startHour === this.endHour) return false;
    if (this.startHour < this.endHour) {
      return hourOfDay >= this.startHour && hourOfDay < this.endHour;
    }
    // Wraps midnight
    return hourOfDay >= this.startHour || hourOfDay < this.endHour;
  }

  /**
   * Apply the discount to a subtotal. Pure: doesn't mutate, doesn't
   * persist. Returns the discounted subtotal.
   *
   * BUNDLE and item-targeted promos require the caller to filter to
   * matching items first; this method only applies to PERCENTAGE,
   * FIXED, and HAPPY_HOUR (also percent).
   */
  applyTo(subtotal: Money): Money {
    switch (this.type) {
      case "PERCENTAGE":
      case "HAPPY_HOUR": {
        const discount = subtotal.multiplyByPercent(this.value);
        return subtotal.subtractClamped(discount);
      }
      case "FIXED": {
        return subtotal.subtractClamped(Money.fromNumber(this.value));
      }
      case "BUNDLE":
        // Bundle pricing is applied externally — just return unchanged here.
        return subtotal;
    }
  }
}
