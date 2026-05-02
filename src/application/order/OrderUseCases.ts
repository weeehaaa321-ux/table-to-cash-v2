// Wrappers around legacy lib/queries.ts and lib/delivery-assignment.ts.
// Routes call these instead of importing lib/* directly. Each method
// preserves the existing behavior; deeper refactor (move logic out of
// queries.ts into proper repositories) is follow-up work tracked in
// docs/MIGRATION-TRACKER.md.

import {
  createOrder,
  getOrdersForRestaurant,
  getOrdersForSession,
  updateOrderStatus,
  appendItemsToOrder,
  getDefaultRestaurant,
  getRestaurantBySlug,
} from "@/lib/queries";
import { autoAssignDelivery } from "@/lib/delivery-assignment";
import { db } from "@/lib/db";

export class OrderUseCases {
  async resolveRestaurantId(id: string): Promise<string | null> {
    if (!id) return null;
    if (id.startsWith("c") && id.length > 10) return id;
    const r = await getRestaurantBySlug(id);
    return r?.id || null;
  }

  async findTableInRestaurant(restaurantId: string, number: number) {
    return db.table.findUnique({
      where: { restaurantId_number: { restaurantId, number } },
    });
  }

  async getSessionStatus(sessionId: string) {
    return db.tableSession.findUnique({
      where: { id: sessionId },
      select: { status: true },
    });
  }

  /**
   * Cancel or comp a single OrderItem and recompute the parent order
   * total. Atomic — wraps both updates in a single transaction so a
   * partial failure doesn't desync item flags from order totals.
   */
  async cancelOrCompItem(input: {
    orderId: string;
    itemId: string;
    action: "cancel" | "comp";
    reason: string | null;
    actorStaffId: string;
  }) {
    const { orderId, itemId, action, reason, actorStaffId } = input;
    const { toNum } = await import("@/lib/money");
    return db.$transaction(async (tx) => {
      if (action === "cancel") {
        await tx.orderItem.update({
          where: { id: itemId, orderId },
          data: { cancelled: true, cancelReason: reason, cancelledAt: new Date() },
        });
      } else {
        await tx.orderItem.update({
          where: { id: itemId, orderId },
          data: {
            comped: true,
            compReason: reason,
            compedBy: actorStaffId,
            compedAt: new Date(),
          },
        });
      }

      const effective = await tx.orderItem.findMany({
        where: { orderId, cancelled: false, comped: false },
        select: { price: true, quantity: true },
      });
      const newSubtotal = Math.round(
        effective.reduce((s, i) => s + toNum(i.price) * i.quantity, 0),
      );

      const anyActive = await tx.orderItem.count({
        where: { orderId, cancelled: false },
      });

      if (anyActive === 0) {
        // Whole order is gone — zero everything money-shaped including
        // the delivery fee column itself, since the customer pays for
        // nothing.
        await tx.order.update({
          where: { id: orderId },
          data: { status: "CANCELLED", subtotal: 0, total: 0, deliveryFee: 0 },
        });
      } else {
        // Partial cancel/comp — recompute total but keep the delivery
        // fee on top. Without re-reading orderType + deliveryFee, the
        // earlier code stripped the fee from total whenever items were
        // edited on a delivery order — visible bug on /delivery
        // (subtotal rendered as total − fee, went negative) and an
        // under-charge for the cashier.
        const order = await tx.order.findUnique({
          where: { id: orderId },
          select: { orderType: true, deliveryFee: true },
        });
        const fee = order?.orderType === "DELIVERY" ? toNum(order.deliveryFee) : 0;
        await tx.order.update({
          where: { id: orderId },
          data: { subtotal: newSubtotal, total: newSubtotal + fee },
        });
      }

      return {
        newTotal: newSubtotal,
        action,
        allCancelled: anyActive === 0,
      };
    });
  }

  async getRestaurantOfOrder(orderId: string) {
    return db.order.findUnique({
      where: { id: orderId },
      select: { restaurantId: true },
    });
  }

  async getStaffShiftRole(staffId: string) {
    return db.staff.findUnique({
      where: { id: staffId },
      select: { shift: true, role: true },
    });
  }

  async getOrderPaymentMethod(orderId: string) {
    return db.order.findUnique({
      where: { id: orderId },
      select: { paymentMethod: true },
    });
  }

  async findOrderForPushContext(orderId: string) {
    return db.order.findUnique({
      where: { id: orderId },
      include: {
        session: { select: { waiterId: true } },
        table: { select: { number: true } },
        deliveryDriver: { select: { id: true } },
      },
    });
  }

  async findById(orderId: string) {
    return db.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { menuItem: { select: { name: true, image: true } } } },
        table: { select: { number: true } },
      },
    });
  }

  async findUnavailableMenuItems(itemIds: string[]) {
    const items = await db.menuItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, name: true, available: true },
    });
    return items.filter((i) => !i.available);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async create(input: Parameters<typeof createOrder>[0]): Promise<any> {
    return createOrder(input);
  }

  async listForRestaurant(
    restaurantId: string,
    opts?: { station?: "KITCHEN" | "BAR" },
  ) {
    return getOrdersForRestaurant(restaurantId, opts);
  }

  async listForSession(sessionId: string) {
    return getOrdersForSession(sessionId);
  }

  async sessionOrdersWithItems(restaurantId: string, sessionId: string) {
    return db.order.findMany({
      where: { restaurantId, sessionId },
      include: {
        items: {
          include: { menuItem: { select: { name: true, image: true } } },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async updateStatus(orderId: string, status: any, restaurantId: string, notes?: string) {
    return updateOrderStatus(orderId, status, restaurantId, notes);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async appendItems(orderId: string, items: any[]) {
    return appendItemsToOrder(orderId, items);
  }

  async assignDelivery(restaurantId: string, orderId: string) {
    return autoAssignDelivery(restaurantId, orderId);
  }

  async defaultRestaurant() {
    return getDefaultRestaurant();
  }
}
