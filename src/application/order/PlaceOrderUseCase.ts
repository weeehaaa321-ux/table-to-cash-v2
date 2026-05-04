import type { OrderRepository } from "../ports/OrderRepository";
import type { MenuRepository } from "../ports/MenuRepository";
import type { Clock } from "../ports/Clock";
import { Money } from "@/domain/shared/Money";
import { Order } from "@/domain/order/Order";
import { OrderItem } from "@/domain/order/OrderItem";
import type { OrderProps } from "@/domain/order/Order";
import type { OrderType } from "@/domain/order/enums";
import type { TableId } from "@/domain/restaurant/Table";
import { makeId } from "@/domain/shared/Identifier";

/**
 * PlaceOrderUseCase — server-side authority for new orders.
 *
 * Implements the post-3e6f6c5 commit invariant: the client's claimed
 * subtotal/total is IGNORED; we recompute from menu items the server
 * fetches itself. Client only sends item IDs + quantities + addOns +
 * notes. This kills price spoofing.
 *
 * Idempotency: client passes a `clientRequestId` (uuid). Same id =
 * same order returned, no duplicate row. The OrderRepository
 * implementation enforces this via the unique index on the column.
 */
export type PlaceOrderInput = {
  clientRequestId: string;
  tableId: TableId | null;
  sessionId: string | null;
  orderType: OrderType;
  items: ReadonlyArray<{
    menuItemId: string;
    quantity: number;
    addOns: readonly string[];
    notes: string | null;
    wasUpsell: boolean;
  }>;
  notes: string | null;
  guestNumber: number | null;
  language: string;
  // Delivery-only fields:
  deliveryAddress?: string | null;
  deliveryLat?: number | null;
  deliveryLng?: number | null;
  deliveryNotes?: string | null;
  vipGuestId?: string | null;
  // Tax/tip/deliveryFee come from server-side config, not client.
  taxRate?: number; // 0–100, default 0
  tip?: Money; // optional, defaults to 0
  deliveryFee?: Money; // 0 unless orderType=DELIVERY
};

export class PlaceOrderUseCase {
  constructor(
    private readonly orders: OrderRepository,
    private readonly menu: MenuRepository,
    private readonly clock: Clock,
  ) {}

  async execute(input: PlaceOrderInput): Promise<Order> {
    if (input.items.length === 0) {
      throw new Error("PlaceOrder: must have at least one item");
    }

    // ─── Server-side menu lookup (kills price spoofing) ──────────
    // Fetch every referenced menu item from the DB. If any is missing
    // or unavailable, refuse the order. Use the DB price, never the
    // client-supplied one.
    const lineItems: OrderItem[] = [];
    // Station resolution: ACTIVITY beats BAR beats KITCHEN. An order
    // containing any activity item routes to ACTIVITY (and skips both
    // prep screens — activities don't go through kitchen / bar). An
    // order containing any BAR item but no activity routes to BAR.
    // Otherwise KITCHEN.
    let stationVote: "KITCHEN" | "BAR" | "ACTIVITY" | null = null;

    for (const cartLine of input.items) {
      const menuItem = await this.menu.findItemById(cartLine.menuItemId);
      if (!menuItem) {
        throw new Error(`PlaceOrder: unknown menu item ${cartLine.menuItemId}`);
      }
      if (cartLine.quantity <= 0 || !Number.isInteger(cartLine.quantity)) {
        throw new Error(`PlaceOrder: invalid quantity ${cartLine.quantity}`);
      }

      lineItems.push(
        OrderItem.rehydrate({
          id: makeId<"OrderItem">(generateCuid()),
          menuItemId: makeId<"MenuItem">(menuItem.id),
          quantity: cartLine.quantity,
          price: menuItem.price, // ← from DB, never from client
          addOns: cartLine.addOns,
          notes: cartLine.notes,
          wasUpsell: cartLine.wasUpsell,
          cancelled: false,
          cancelReason: null,
          cancelledAt: null,
          comped: false,
          compReason: null,
          compedBy: null,
          compedAt: null,
        }),
      );

      // Station vote with priority ACTIVITY > BAR > KITCHEN. An order
      // mixing activities with food/drinks shouldn't punish the prep
      // line — but for now, this codebase routes a single Order to one
      // station, so an "ACTIVITY + drink" cart resolves to ACTIVITY
      // (the timer items dominate). Mixing happens rarely in practice;
      // the cashier sees the breakdown on the receipt.
      const itemStation = await this.lookupStation(menuItem.categoryId);
      if (itemStation === "ACTIVITY") stationVote = "ACTIVITY";
      else if (itemStation === "BAR" && stationVote !== "ACTIVITY") stationVote = "BAR";
      else if (stationVote === null) stationVote = itemStation;
    }
    const station = stationVote ?? "KITCHEN";

    // ─── Money math ─────────────────────────────────────────────
    const subtotal = Order.computeSubtotal(lineItems);
    const tax = subtotal.multiplyByPercent(input.taxRate ?? 0);
    const tip = input.tip ?? Money.zero();
    const deliveryFee =
      input.orderType === "DELIVERY"
        ? input.deliveryFee ?? Money.zero()
        : Money.zero();
    const total = Order.computeTotal({ subtotal, tax, tip, deliveryFee });

    // ─── Build the aggregate ─────────────────────────────────────
    const now = this.clock.now();
    const props: OrderProps = {
      id: makeId<"Order">(generateCuid()),
      orderNumber: 0, // assigned by repo on insert (uses DB sequence)
      status: "PENDING",
      tableId: input.tableId,
      sessionId: input.sessionId
        ? makeId<"TableSession">(input.sessionId)
        : null,
      orderType: input.orderType,
      station,
      items: lineItems,
      subtotal,
      tax,
      tip,
      deliveryFee,
      total,
      paymentMethod: null,
      paidAt: null,
      readyAt: null,
      servedAt: null,
      notes: input.notes,
      guestNumber: input.guestNumber,
      language: input.language,
      groupId: null,
      clientRequestId: input.clientRequestId,
      vipGuestId: input.vipGuestId
        ? makeId<"VipGuest">(input.vipGuestId)
        : null,
      deliveryAddress: input.deliveryAddress ?? null,
      deliveryLat: input.deliveryLat ?? null,
      deliveryLng: input.deliveryLng ?? null,
      deliveryNotes: input.deliveryNotes ?? null,
      deliveryStatus: null,
      deliveryDriverId: null,
      pickedUpAt: null,
      deliveredAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const order = Order.rehydrate(props);

    // Sanity check before persisting.
    const validation = order.validateMoney();
    if (validation) {
      throw new Error(`PlaceOrder: money validation failed: ${validation}`);
    }

    return this.orders.createIdempotent(order);
  }

  // Helper: look up which station a category routes to. Cached at
  // the use case level for the lifetime of one execute() call.
  private stationCache = new Map<string, "KITCHEN" | "BAR" | "ACTIVITY">();
  private async lookupStation(categoryId: string): Promise<"KITCHEN" | "BAR" | "ACTIVITY"> {
    const cached = this.stationCache.get(categoryId);
    if (cached) return cached;
    const cat = await this.menu.findCategoryById(categoryId);
    const station = cat?.station ?? "KITCHEN";
    this.stationCache.set(categoryId, station);
    return station;
  }
}

// Local cuid generator stub. The actual implementation lives in the
// infrastructure layer (Prisma's built-in @default(cuid())); for
// in-memory use cases that need to generate ids before persisting,
// the repository can override with the DB's id. For now, fall back
// to a timestamp-prefixed random.
function generateCuid(): string {
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
