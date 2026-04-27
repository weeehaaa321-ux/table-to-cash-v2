// Delivery flows — order assignment, status updates, online/offline toggle.

import { db } from "@/lib/db";
import { autoAssignDelivery, assignPendingDeliveries } from "@/lib/delivery-assignment";

export class DeliveryUseCases {
  async resolveRestaurantId(id: string): Promise<string | null> {
    if (!id) return null;
    if (id.startsWith("c") && id.length > 10) return id;
    const r = await db.restaurant.findUnique({ where: { slug: id }, select: { id: true } });
    return r?.id || null;
  }

  /** Single delivery-order tracking lookup (used by VIP track page). */
  async findOrderForTracking(orderId: string, restaurantId: string) {
    return db.order.findFirst({
      where: { id: orderId, restaurantId, orderType: "DELIVERY" },
      include: { deliveryDriver: { select: { id: true, name: true } } },
    });
  }

  /**
   * The big delivery board query — driver view if driverId given,
   * owner view otherwise. Mirrors the legacy filter exactly.
   */
  async listForBoard(input: {
    restaurantId: string;
    driverId: string | null;
    todayStartUTC: Date;
  }) {
    const { restaurantId, driverId, todayStartUTC } = input;
    return db.order.findMany({
      where: {
        restaurantId,
        orderType: "DELIVERY",
        AND: [
          {
            OR: [
              { status: { notIn: ["PAID", "CANCELLED"] } },
              { deliveredAt: { gte: todayStartUTC } },
            ],
          },
          ...(driverId ? [{
            OR: [
              { deliveryDriverId: driverId },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              { deliveryDriverId: null, status: { notIn: ["PENDING", "CANCELLED", "PAID"] as any } },
            ],
          }] : []),
          ...(!driverId ? [{
            OR: [
              { deliveryDriverId: { not: null } },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              { deliveryDriverId: null, status: { notIn: ["PENDING", "CANCELLED", "PAID"] as any } },
              { deliveredAt: { gte: todayStartUTC } },
            ],
          }] : []),
        ],
      },
      include: {
        items: { include: { menuItem: { select: { name: true } } } },
        vipGuest: { select: { name: true, phone: true, address: true, addressNotes: true, locationLat: true, locationLng: true } },
        deliveryDriver: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
  }

  /** Atomic driver claim — returns the order if the claim succeeded. */
  async getOrderScope(orderId: string) {
    return db.order.findUnique({
      where: { id: orderId },
      select: { restaurantId: true, deliveryDriverId: true },
    });
  }

  async getOrderStatus(orderId: string) {
    return db.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
  }

  async applyStatusUpdate(orderId: string, data: Record<string, unknown>) {
    return db.order.update({
      where: { id: orderId },
      data: data as never,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        deliveryStatus: true,
        sessionId: true,
        paymentMethod: true,
        paidAt: true,
        restaurantId: true,
      },
    });
  }

  async markPaid(orderId: string) {
    return db.order.update({
      where: { id: orderId },
      data: { status: "PAID" },
      select: { id: true },
    });
  }

  async claimOrder(orderId: string, driverId: string) {
    const updated = await db.order.updateMany({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      where: { id: orderId, deliveryDriverId: null, status: { notIn: ["PENDING", "CANCELLED", "PAID"] as any } },
      data: { deliveryDriverId: driverId, deliveryStatus: "ASSIGNED" },
    });
    if (updated.count === 0) return null;
    return db.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true, deliveryStatus: true },
    });
  }

  async assignPending(restaurantId: string) {
    return assignPendingDeliveries(restaurantId);
  }
  async setDriverOnline(staffId: string, online: boolean) {
    return db.staff.update({
      where: { id: staffId },
      data: { deliveryOnline: online },
    });
  }

  async getDriverStatus(staffId: string) {
    return db.staff.findUnique({
      where: { id: staffId },
      select: { id: true, deliveryOnline: true, role: true, active: true, restaurantId: true },
    });
  }

  async countOnlineDrivers(restaurantId: string): Promise<number> {
    return db.staff.count({
      where: { restaurantId, role: "DELIVERY", active: true, deliveryOnline: true },
    });
  }

  async listAvailableDrivers(restaurantId: string) {
    return db.staff.findMany({
      where: {
        restaurantId,
        active: true,
        role: "DELIVERY",
        deliveryOnline: true,
      },
      select: { id: true, name: true, code: true },
    });
  }

  async assignToOrder(restaurantId: string, orderId: string) {
    return autoAssignDelivery(restaurantId, orderId);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async updateOrderStatus(orderId: string, status: any) {
    const data: Record<string, unknown> = { deliveryStatus: status };
    if (status === "PICKED_UP") data.pickedUpAt = new Date();
    if (status === "DELIVERED") data.deliveredAt = new Date();
    return db.order.update({ where: { id: orderId }, data });
  }

  async listForDriver(driverId: string) {
    return db.order.findMany({
      where: {
        deliveryDriverId: driverId,
        deliveryStatus: { in: ["ASSIGNED", "PICKED_UP", "ON_THE_WAY"] },
      },
      include: {
        items: { include: { menuItem: { select: { name: true, image: true } } } },
        vipGuest: true,
      },
      orderBy: { createdAt: "asc" },
    });
  }
}
