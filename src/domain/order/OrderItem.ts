import type { Identifier } from "../shared/Identifier";
import { Money } from "../shared/Money";
import type { MenuItemId } from "../menu/MenuItem";

export type OrderItemId = Identifier<"OrderItem">;

/**
 * Line item on an Order. Captures the price at the time of ordering
 * (not the current MenuItem.price), so receipts and history are stable
 * even after menu price changes.
 *
 * `addOns` is a string array in the source schema — by convention these
 * are AddOn IDs OR free-text labels that the kitchen sees on the ticket.
 *
 * Cancellation and "comp" (free) tracking are first-class fields,
 * because the cashier flow needs them to compute the bill correctly:
 *   subtotal = sum of (quantity × price) for items that are not
 *              cancelled and not comped.
 */
export class OrderItem {
  private constructor(
    public readonly id: OrderItemId,
    public readonly menuItemId: MenuItemId | null,
    public readonly quantity: number,
    public readonly priceAtOrder: Money,
    public readonly addOns: readonly string[],
    public readonly notes: string | null,
    public readonly wasUpsell: boolean,
    public readonly cancelled: boolean,
    public readonly cancelReason: string | null,
    public readonly cancelledAt: Date | null,
    public readonly comped: boolean,
    public readonly compReason: string | null,
    public readonly compedBy: string | null,
    public readonly compedAt: Date | null,
  ) {}

  static rehydrate(props: {
    id: OrderItemId;
    menuItemId: MenuItemId | null;
    quantity: number;
    price: Money;
    addOns: readonly string[];
    notes: string | null;
    wasUpsell: boolean;
    cancelled: boolean;
    cancelReason: string | null;
    cancelledAt: Date | null;
    comped: boolean;
    compReason: string | null;
    compedBy: string | null;
    compedAt: Date | null;
  }): OrderItem {
    return new OrderItem(
      props.id,
      props.menuItemId,
      props.quantity,
      props.price,
      props.addOns,
      props.notes,
      props.wasUpsell,
      props.cancelled,
      props.cancelReason,
      props.cancelledAt,
      props.comped,
      props.compReason,
      props.compedBy,
      props.compedAt,
    );
  }

  /**
   * The amount this item contributes to the order subtotal.
   * Cancelled or comped items contribute zero — they appear on the
   * receipt as line items but don't add to the bill.
   */
  lineTotal(): Money {
    if (this.cancelled || this.comped) return Money.zero();
    return this.priceAtOrder.multiplyByQuantity(this.quantity);
  }

  /**
   * The "ticket value" — what the kitchen sees regardless of comp/cancel.
   * Used for kitchen analytics and prep-time estimation.
   */
  ticketValue(): Money {
    return this.priceAtOrder.multiplyByQuantity(this.quantity);
  }
}
