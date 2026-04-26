import type { Identifier } from "../shared/Identifier";
import { Money, sumMoney } from "../shared/Money";
import type { TableId } from "../restaurant/Table";
import type { Station } from "../menu/Category";
import { canTransition, isTerminal } from "./enums";
import type {
  OrderStatus,
  PaymentMethod,
  OrderType,
  DeliveryStatus,
} from "./enums";
import { OrderItem } from "./OrderItem";

export type OrderId = Identifier<"Order">;
export type SessionId = Identifier<"TableSession">;
export type VipGuestId = Identifier<"VipGuest">;
export type StaffId = Identifier<"Staff">;

/**
 * Order — aggregate root for a single placed order.
 *
 * One order = one submission from one origin (one QR scan + tap, one
 * VIP delivery flow, one walk-in cashier ring-up). Multi-round dining
 * sessions accumulate multiple orders under one TableSession.
 *
 * Money invariants enforced by domain (mirroring the recent commit
 * `3e6f6c5 Lock money endpoints, kill price/total spoofing`):
 *   - subtotal must equal sum of OrderItem.lineTotal()
 *   - total must equal subtotal + tax + tip + deliveryFee
 *   - clients cannot send subtotal/total — server recomputes
 *
 * The `clientRequestId` field provides idempotency: same submission
 * retried (network blip) results in one order, not duplicates.
 */
export class Order {
  private constructor(
    public readonly id: OrderId,
    public readonly orderNumber: number,
    public readonly status: OrderStatus,
    public readonly tableId: TableId | null,
    public readonly sessionId: SessionId | null,
    public readonly orderType: OrderType,
    public readonly station: Station,
    public readonly items: readonly OrderItem[],
    public readonly subtotal: Money,
    public readonly tax: Money,
    public readonly tip: Money,
    public readonly deliveryFee: Money,
    public readonly total: Money,
    public readonly paymentMethod: PaymentMethod | null,
    public readonly paidAt: Date | null,
    public readonly readyAt: Date | null,
    public readonly servedAt: Date | null,
    public readonly notes: string | null,
    public readonly guestNumber: number | null,
    public readonly language: string,
    public readonly groupId: string | null,
    public readonly clientRequestId: string | null,
    public readonly vipGuestId: VipGuestId | null,
    public readonly deliveryAddress: string | null,
    public readonly deliveryLat: number | null,
    public readonly deliveryLng: number | null,
    public readonly deliveryNotes: string | null,
    public readonly deliveryStatus: DeliveryStatus | null,
    public readonly deliveryDriverId: StaffId | null,
    public readonly pickedUpAt: Date | null,
    public readonly deliveredAt: Date | null,
    public readonly createdAt: Date,
    public readonly updatedAt: Date,
  ) {}

  static rehydrate(props: ConstructorParameters<typeof Order>[0] extends never
    ? never
    : OrderProps): Order {
    return new Order(
      props.id,
      props.orderNumber,
      props.status,
      props.tableId,
      props.sessionId,
      props.orderType,
      props.station,
      props.items,
      props.subtotal,
      props.tax,
      props.tip,
      props.deliveryFee,
      props.total,
      props.paymentMethod,
      props.paidAt,
      props.readyAt,
      props.servedAt,
      props.notes,
      props.guestNumber,
      props.language,
      props.groupId,
      props.clientRequestId,
      props.vipGuestId,
      props.deliveryAddress,
      props.deliveryLat,
      props.deliveryLng,
      props.deliveryNotes,
      props.deliveryStatus,
      props.deliveryDriverId,
      props.pickedUpAt,
      props.deliveredAt,
      props.createdAt,
      props.updatedAt,
    );
  }

  // ─── Money math (the hot spot) ────────────────────────────────

  /**
   * Recompute subtotal from line items. This is what server-side code
   * uses — never trusts the client's claimed subtotal.
   */
  static computeSubtotal(items: readonly OrderItem[]): Money {
    return sumMoney(items.map((i) => i.lineTotal()));
  }

  /**
   * Recompute total = subtotal + tax + tip + deliveryFee.
   * Mirrors the source repo's invoice/cashier math exactly.
   */
  static computeTotal(parts: {
    subtotal: Money;
    tax: Money;
    tip: Money;
    deliveryFee: Money;
  }): Money {
    return parts.subtotal.add(parts.tax).add(parts.tip).add(parts.deliveryFee);
  }

  /**
   * Verify the entity's stored money matches what would be computed
   * from its current line items. Used as a sanity check after rehydration.
   * Returns null if consistent, error message if not.
   */
  validateMoney(): string | null {
    const expectedSubtotal = Order.computeSubtotal(this.items);
    if (!this.subtotal.equals(expectedSubtotal)) {
      return `subtotal mismatch: stored ${this.subtotal.toDecimalString()}, computed ${expectedSubtotal.toDecimalString()}`;
    }
    const expectedTotal = Order.computeTotal({
      subtotal: this.subtotal,
      tax: this.tax,
      tip: this.tip,
      deliveryFee: this.deliveryFee,
    });
    if (!this.total.equals(expectedTotal)) {
      return `total mismatch: stored ${this.total.toDecimalString()}, computed ${expectedTotal.toDecimalString()}`;
    }
    return null;
  }

  // ─── State transitions ────────────────────────────────────────

  /**
   * Pure function: returns whether moving from current status to the
   * given target status is allowed by the state machine. Side-effect-
   * free; the actual mutation happens in a use case + repository.
   */
  canTransitionTo(target: OrderStatus): boolean {
    return canTransition(this.status, target);
  }

  isTerminal(): boolean {
    return isTerminal(this.status);
  }

  isDelivery(): boolean {
    return this.orderType === "DELIVERY";
  }

  isVipDineIn(): boolean {
    return this.orderType === "VIP_DINE_IN";
  }
}

// Helper type so rehydrate() stays typed without the Order constructor
// being exposed publicly.
export type OrderProps = {
  id: OrderId;
  orderNumber: number;
  status: OrderStatus;
  tableId: TableId | null;
  sessionId: SessionId | null;
  orderType: OrderType;
  station: Station;
  items: readonly OrderItem[];
  subtotal: Money;
  tax: Money;
  tip: Money;
  deliveryFee: Money;
  total: Money;
  paymentMethod: PaymentMethod | null;
  paidAt: Date | null;
  readyAt: Date | null;
  servedAt: Date | null;
  notes: string | null;
  guestNumber: number | null;
  language: string;
  groupId: string | null;
  clientRequestId: string | null;
  vipGuestId: VipGuestId | null;
  deliveryAddress: string | null;
  deliveryLat: number | null;
  deliveryLng: number | null;
  deliveryNotes: string | null;
  deliveryStatus: DeliveryStatus | null;
  deliveryDriverId: StaffId | null;
  pickedUpAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
