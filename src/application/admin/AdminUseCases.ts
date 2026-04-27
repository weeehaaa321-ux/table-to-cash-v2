// Admin / destructive operations. Each is guarded by the route
// (env-flag, owner-auth) — the use case itself just executes.

import { db } from "@/lib/db";
import { normalizeKitchenConfig } from "@/lib/kitchen-config";

export class AdminUseCases {
  /** Liveness probe — minimal cheap query. */
  async ping(): Promise<void> {
    await db.$queryRaw`SELECT 1`;
  }

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

  /** Shift- or full-clear used by /api/clear (non-goLive branch). */
  async clearTransactional(restaurantId: string, since?: Date): Promise<{
    orders: number; sessions: number; messages: number; ratings: number; settlements: number;
  }> {
    const where = since
      ? { restaurantId, createdAt: { gte: since } }
      : { restaurantId };
    const sessionWhere = since
      ? { restaurantId, openedAt: { gte: since } }
      : { restaurantId };
    const messageWhere = since
      ? { restaurantId, createdAt: { gte: since } }
      : { restaurantId };

    const sessions = await db.tableSession.findMany({ where: sessionWhere, select: { id: true } });
    const sessionIds = sessions.map((s) => s.id);

    let deletedRatings = { count: 0 };
    if (sessionIds.length > 0) {
      deletedRatings = await db.rating.deleteMany({
        where: { sessionId: { in: sessionIds } },
      });
    }

    const orders = await db.order.findMany({ where, select: { id: true } });
    const orderIds = orders.map((o) => o.id);

    if (orderIds.length > 0) {
      await db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    }

    const deletedOrders = await db.order.deleteMany({ where });
    const deletedSettlements = await db.cashSettlement.deleteMany({
      where: since
        ? { restaurantId, requestedAt: { gte: since } }
        : { restaurantId },
    });

    if (sessionIds.length > 0) {
      await db.joinRequest.deleteMany({ where: { sessionId: { in: sessionIds } } }).catch(() => {});
    }

    const deletedSessions = await db.tableSession.deleteMany({ where: sessionWhere });
    const deletedMessages = await db.message.deleteMany({ where: messageWhere });

    return {
      orders: deletedOrders.count,
      sessions: deletedSessions.count,
      messages: deletedMessages.count,
      ratings: deletedRatings.count,
      settlements: deletedSettlements.count,
    };
  }

  /** Full go-live wipe: also drops drawers, schedules, staff shifts, push subs, VIP. */
  async goLiveReset(restaurantId: string): Promise<Record<string, number>> {
    const sessions = await db.tableSession.findMany({ where: { restaurantId }, select: { id: true } });
    const sessionIds = sessions.map((s) => s.id);

    const orders = await db.order.findMany({ where: { restaurantId }, select: { id: true } });
    const orderIds = orders.map((o) => o.id);

    const deleted: Record<string, number> = {};

    if (sessionIds.length > 0) {
      const r = await db.rating.deleteMany({ where: { sessionId: { in: sessionIds } } });
      deleted.ratings = r.count;
      const j = await db.joinRequest.deleteMany({ where: { sessionId: { in: sessionIds } } }).catch(() => ({ count: 0 }));
      deleted.joinRequests = j.count;
    }

    if (orderIds.length > 0) {
      const oi = await db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      deleted.orderItems = oi.count;
    }

    deleted.orders = (await db.order.deleteMany({ where: { restaurantId } })).count;
    deleted.settlements = (await db.cashSettlement.deleteMany({ where: { restaurantId } })).count;
    deleted.sessions = (await db.tableSession.deleteMany({ where: { restaurantId } })).count;
    deleted.messages = (await db.message.deleteMany({ where: { restaurantId } })).count;
    deleted.cashDrawers = (await db.cashDrawer.deleteMany({ where: { restaurantId } })).count;
    deleted.staffShifts = (await db.staffShift.deleteMany({ where: { restaurantId } })).count;
    deleted.dailyCloses = (await db.dailyClose.deleteMany({ where: { restaurantId } })).count;
    deleted.pushSubscriptions = (await db.pushSubscription.deleteMany({
      where: { staff: { restaurantId } },
    })).count;
    deleted.vipGuests = (await db.vipGuest.deleteMany({ where: { restaurantId } })).count;

    return deleted;
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
