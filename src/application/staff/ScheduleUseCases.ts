import { db } from "@/lib/db";
import { syncTodaySchedule, invalidateScheduleSync } from "@/lib/schedule-sync";

export class ScheduleUseCases {
  async list(restaurantId: string, from: Date, to: Date) {
    return db.shiftSchedule.findMany({
      where: { restaurantId, date: { gte: from, lte: to } },
      orderBy: [{ date: "asc" }, { shift: "asc" }],
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async upsert(data: { staffId: string; date: Date; shift: number; restaurantId: string }) {
    return db.shiftSchedule.upsert({
      where: { staffId_date: { staffId: data.staffId, date: data.date } },
      create: data,
      update: { shift: data.shift },
    });
  }

  async remove(id: string) {
    return db.shiftSchedule.delete({ where: { id } });
  }

  async sync(restaurantId: string) {
    return syncTodaySchedule(restaurantId);
  }

  async forceSync(restaurantId: string) {
    invalidateScheduleSync(restaurantId);
    return syncTodaySchedule(restaurantId);
  }

  async resolveRestaurantId(id: string): Promise<string | null> {
    if (!id) return null;
    if (id.startsWith("c") && id.length > 10) return id;
    const r = await db.restaurant.findUnique({ where: { slug: id }, select: { id: true } });
    return r?.id || null;
  }

  /** Cashout — sum of cash payments by waiter for a shift window. */
  async cashout(restaurantId: string, waiterId: string | null, since: Date) {
    const where: Record<string, unknown> = {
      restaurantId,
      paymentMethod: "CASH",
      paidAt: { gte: since },
    };
    if (waiterId) {
      where.session = { waiterId };
    }
    const orders = await db.order.findMany({
      where,
      select: { total: true, paidAt: true, sessionId: true },
    });
    const total = orders.reduce((s, o) => s + Number(o.total), 0);
    return { total, count: orders.length };
  }
}
