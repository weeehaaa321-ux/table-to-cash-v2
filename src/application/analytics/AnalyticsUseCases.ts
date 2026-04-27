import { db } from "@/lib/db";

export class AnalyticsUseCases {
  async resolveRestaurantId(id: string): Promise<string | null> {
    if (!id) return null;
    if (id.startsWith("c") && id.length > 10) return id;
    const r = await db.restaurant.findUnique({ where: { slug: id }, select: { id: true } });
    return r?.id || null;
  }

  /** The big dashboard pull — orders + sessions + staff for a window. */
  async listForDashboard(restaurantId: string, since: Date) {
    const [orders, sessions, staff] = await Promise.all([
      db.order.findMany({
        where: {
          restaurantId,
          createdAt: { gte: since },
          status: { in: ["PAID", "SERVED", "READY", "PREPARING", "CONFIRMED"] },
        },
        select: {
          id: true,
          total: true,
          createdAt: true,
          paidAt: true,
          readyAt: true,
          servedAt: true,
          status: true,
          paymentMethod: true,
          sessionId: true,
          items: {
            select: {
              quantity: true,
              price: true,
              menuItem: { select: { id: true, name: true } },
            },
          },
          session: { select: { waiterId: true } },
        },
      }),
      db.tableSession.findMany({
        where: { restaurantId, openedAt: { gte: since } },
        select: { id: true, openedAt: true, closedAt: true, guestCount: true, waiterId: true },
      }),
      db.staff.findMany({
        where: { restaurantId },
        select: { id: true, name: true, role: true, active: true },
      }),
    ]);
    return { orders, sessions, staff };
  }

  /** Cancelled + comped item rollup for a set of orders. */
  async cancelledAndCompedForOrders(orderIds: string[], since: Date) {
    if (orderIds.length === 0) return [[], []] as const;
    return Promise.all([
      db.orderItem.findMany({
        where: {
          cancelled: true,
          cancelledAt: { gte: since },
          orderId: { in: orderIds },
        },
        select: {
          quantity: true,
          price: true,
          cancelReason: true,
          menuItem: { select: { name: true } },
        },
      }),
      db.orderItem.findMany({
        where: {
          comped: true,
          compedAt: { gte: since },
          orderId: { in: orderIds },
        },
        select: {
          quantity: true,
          price: true,
          compReason: true,
          menuItem: { select: { name: true } },
        },
      }),
    ] as const);
  }

  /** Daily revenue + order count for the last N days. */
  async dailyRevenue(restaurantId: string, days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const orders = await db.order.findMany({
      where: { restaurantId, paidAt: { gte: since } },
      select: { total: true, paidAt: true, paymentMethod: true, items: { select: { wasUpsell: true } } },
    });
    return orders;
  }

  /** Item performance — views vs orders. */
  async itemPerformance(restaurantId: string, days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    const items = await db.menuItem.findMany({
      where: { category: { restaurantId } },
      select: {
        id: true, name: true, views: true, price: true,
        orderItems: {
          where: { order: { paidAt: { gte: since } } },
          select: { quantity: true, price: true },
        },
      },
    });
    return items.map((it) => ({
      id: it.id,
      name: it.name,
      views: it.views,
      orders: it.orderItems.reduce((s, o) => s + o.quantity, 0),
      revenue: it.orderItems.reduce((s, o) => s + Number(o.price) * o.quantity, 0),
      price: Number(it.price),
    }));
  }

  /** Export orders as CSV-shaped rows. */
  async exportOrders(restaurantId: string, from: Date, to: Date) {
    return db.order.findMany({
      where: { restaurantId, createdAt: { gte: from, lte: to } },
      include: {
        items: { include: { menuItem: { select: { name: true } } } },
        table: { select: { number: true } },
      },
      orderBy: { createdAt: "asc" },
    });
  }

  /** Same as exportOrders but with session+waiter context for richer CSVs. */
  async exportOrdersWithSession(restaurantId: string, from: Date, to: Date) {
    return db.order.findMany({
      where: { restaurantId, createdAt: { gte: from, lte: to } },
      include: {
        items: { include: { menuItem: { select: { name: true } } } },
        table: { select: { number: true } },
        session: {
          select: { id: true, waiter: { select: { name: true } }, guestCount: true },
        },
      },
      orderBy: { createdAt: "asc" },
    });
  }
}
