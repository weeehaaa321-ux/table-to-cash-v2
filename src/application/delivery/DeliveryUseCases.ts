// Delivery flows — order assignment, status updates, online/offline toggle.

import { db } from "@/lib/db";
import { autoAssignDelivery, assignPendingDeliveries } from "@/lib/delivery-assignment";

export class DeliveryUseCases {
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
