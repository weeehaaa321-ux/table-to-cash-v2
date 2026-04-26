// Admin / destructive operations. Each is guarded by the route
// (env-flag, owner-auth) — the use case itself just executes.

import { db } from "@/lib/db";
import { normalizeKitchenConfig } from "@/lib/kitchen-config";

export class AdminUseCases {
  async resolveRestaurantId(id: string): Promise<string | null> {
    if (!id) return null;
    if (id.startsWith("c") && id.length > 10) return id;
    const r = await db.restaurant.findUnique({ where: { slug: id }, select: { id: true } });
    return r?.id || null;
  }

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

  async getKitchenConfig(restaurantId: string) {
    const r = await db.restaurant.findUnique({
      where: { id: restaurantId },
      select: { kitchenConfig: true },
    });
    return normalizeKitchenConfig(r?.kitchenConfig);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async setKitchenConfig(restaurantId: string, raw: any) {
    const config = normalizeKitchenConfig(raw);
    await db.restaurant.update({
      where: { id: restaurantId },
      data: { kitchenConfig: config },
    });
    return config;
  }

  // alias for the kitchen-config route's PUT shape
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async setKitchenConfigNormalized(restaurantId: string, raw: any) {
    return this.setKitchenConfig(restaurantId, raw);
  }
}
