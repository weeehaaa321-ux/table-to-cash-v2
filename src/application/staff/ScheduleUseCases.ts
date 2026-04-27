import { db } from "@/lib/db";
import { syncTodaySchedule, invalidateScheduleSync } from "@/lib/schedule-sync";

export class ScheduleUseCases {
  async list(restaurantId: string, from: Date, to: Date) {
    return db.shiftSchedule.findMany({
      where: { restaurantId, date: { gte: from, lte: to } },
      orderBy: [{ date: "asc" }, { shift: "asc" }],
    });
  }

  /** Month-of-staff list with optional staff filter; used by /api/schedule GET. */
  async listMonth(input: { restaurantId: string; from: Date; to: Date; staffId?: string }) {
    const where: Record<string, unknown> = {
      restaurantId: input.restaurantId,
      date: { gte: input.from, lt: input.to },
    };
    if (input.staffId) where.staffId = input.staffId;
    return db.shiftSchedule.findMany({
      where,
      select: { id: true, staffId: true, date: true, shift: true },
      orderBy: { date: "asc" },
    });
  }

  async getStaffRole(id: string) {
    return db.staff.findUnique({ where: { id }, select: { role: true } });
  }

  async deleteByStaffDate(staffId: string, date: Date) {
    return db.shiftSchedule.deleteMany({ where: { staffId, date } });
  }

  invalidateSync(restaurantId: string) {
    invalidateScheduleSync(restaurantId);
  }

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

  async listWaitersAndCashiers(restaurantId: string) {
    return db.staff.findMany({
      where: { restaurantId, role: { in: ["WAITER", "CASHIER"] } },
      select: { id: true, name: true, shift: true, active: true, role: true },
    });
  }

  async listSessionsWithPaidOrdersInRange(input: {
    restaurantId: string;
    rangeStart: Date;
    rangeEnd: Date;
  }) {
    const { restaurantId, rangeStart, rangeEnd } = input;
    return db.tableSession.findMany({
      where: {
        restaurantId,
        waiterId: { not: null },
        orders: {
          some: {
            status: { not: "CANCELLED" },
            paidAt: { gte: rangeStart, lt: rangeEnd },
          },
        },
      },
      include: {
        orders: {
          where: { status: { not: "CANCELLED" }, paidAt: { gte: rangeStart, lt: rangeEnd } },
          select: { total: true, tip: true, paymentMethod: true, paidAt: true, createdAt: true },
        },
        waiter: { select: { id: true, name: true } },
        table: { select: { number: true } },
      },
      orderBy: { openedAt: "asc" },
    });
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
