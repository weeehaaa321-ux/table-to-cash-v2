import { db } from "@/lib/db";

export class AnalyticsUseCases {
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
}
