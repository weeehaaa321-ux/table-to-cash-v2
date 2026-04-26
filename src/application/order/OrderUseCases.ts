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
