// Admin / destructive operations. Each is guarded by the route
// (env-flag, owner-auth) — the use case itself just executes.

import { db } from "@/lib/db";

export class AdminUseCases {
  /** Wipe a restaurant's transactional data. Keeps menu + staff. */
  async clearRestaurantData(restaurantId: string) {
    await db.joinRequest.deleteMany({
      where: { session: { restaurantId } },
    }).catch(() => {});
    await db.rating.deleteMany({ where: { restaurantId } }).catch(() => {});
    await db.orderItem.deleteMany({
      where: { order: { restaurantId } },
    });
    await db.order.deleteMany({ where: { restaurantId } });
    await db.tableSession.deleteMany({ where: { restaurantId } });
    await db.cashSettlement.deleteMany({ where: { restaurantId } });
    await db.cashDrawer.deleteMany({ where: { restaurantId } });
    await db.message.deleteMany({ where: { restaurantId } });
    await db.dailyClose.deleteMany({ where: { restaurantId } });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async setKitchenConfig(restaurantId: string, config: any) {
    return db.restaurant.update({
      where: { id: restaurantId },
      data: { kitchenConfig: config },
    });
  }
}
