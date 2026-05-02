// /api/live-snapshot and /api/guest-poll — polled "real-time" data
// for kitchen / floor / guest screens. Pure read-only aggregations.

import { db } from "@/lib/db";
import { toNum } from "@/lib/money";

export class LivePollUseCases {
  /** Open-or-closed-today sessions for the floor dashboard. */
  async listSessionsForSnapshot(restaurantId: string, todayStartUTC: Date) {
    return db.tableSession.findMany({
      where: {
        restaurantId,
        OR: [{ status: "OPEN" }, { closedAt: { gte: todayStartUTC } }],
      },
      include: {
        table: { select: { number: true } },
        waiter: { select: { id: true, name: true } },
        vipGuest: { select: { name: true } },
        orders: {
          select: { id: true, orderNumber: true, total: true, status: true, paymentMethod: true, paidAt: true, guestNumber: true, guestName: true },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { openedAt: "desc" },
    });
  }

  /** Open sessions whose waiter belongs to a different shift — for the
   *  shift-change reassignment side effect in /api/live-snapshot. */
  async listOpenSessionsWithWaiterShift(restaurantId: string) {
    return db.tableSession.findMany({
      where: { restaurantId, status: "OPEN", waiterId: { not: null } },
      include: { waiter: { select: { id: true, shift: true } } },
    });
  }

  /** Every OPEN session that needs a waiter — i.e., dine-in (TABLE or
   *  VIP_DINE_IN). DELIVERY sessions are excluded because they're
   *  driven by a deliveryDriverId, not a waiter; treating them as
   *  orphan-waiter sessions would push a waiter onto orders that don't
   *  belong on the floor. The reassign sweep needs both null-waiter
   *  rows (need adoption) and assigned ones (might need reassignment
   *  if waiter is off-shift or no longer clocked in). */
  async listAllOpenSessions(restaurantId: string) {
    return db.tableSession.findMany({
      where: {
        restaurantId,
        status: "OPEN",
        orderType: { not: "DELIVERY" },
      },
      include: { waiter: { select: { id: true, shift: true } } },
    });
  }

  async listWaitersForShifts(restaurantId: string, shifts: number[]) {
    return db.staff.findMany({
      where: { restaurantId, role: "WAITER", active: true, shift: { in: shifts } },
      orderBy: { createdAt: "asc" },
    });
  }

  async assignWaiterToSession(sessionId: string, waiterId: string) {
    return db.tableSession.update({
      where: { id: sessionId },
      data: { waiterId },
    });
  }

  async sumTipsSince(restaurantId: string, since: Date): Promise<number> {
    const agg = await db.order.aggregate({
      where: {
        restaurantId,
        paidAt: { gte: since },
        status: { not: "CANCELLED" },
      },
      _sum: { tip: true },
    });
    return Math.round(toNum(agg._sum.tip));
  }

  async listTables(restaurantId: string) {
    return db.table.findMany({
      where: { restaurantId },
      select: { id: true, number: true, label: true },
      orderBy: { number: "asc" },
    });
  }


  /** Owner / floor manager dashboard snapshot. */
  async liveSnapshot(restaurantId: string) {
    const [orders, sessions, staff] = await Promise.all([
      db.order.findMany({
        where: {
          restaurantId,
          status: { in: ["PENDING", "CONFIRMED", "PREPARING", "READY"] },
        },
        include: { items: true, table: { select: { number: true } } },
        take: 100,
      }),
      db.tableSession.findMany({
        where: { restaurantId, status: "OPEN" },
        include: { table: { select: { number: true } } },
      }),
      db.staff.findMany({
        where: { restaurantId, active: true },
        select: { id: true, name: true, role: true, shift: true },
      }),
    ]);
    return { orders, sessions, staff };
  }

  /** Bundled guest-poll fetch — session + orders + delegation + join + tracked order. */
  async guestPollBundle(input: {
    sessionId: string;
    restaurantId: string;
    orderId?: string | null;
  }) {
    const { sessionId, restaurantId, orderId } = input;
    return Promise.all([
      db.tableSession.findUnique({
        where: { id: sessionId },
        select: {
          id: true,
          status: true,
          guestCount: true,
          tableId: true,
          table: { select: { number: true } },
        },
      }),
      db.order.findMany({
        where: { sessionId, restaurantId },
        include: { items: { include: { menuItem: { select: { name: true } } } } },
        orderBy: { createdAt: "desc" },
      }),
      db.message.findFirst({
        where: { type: "payment_delegate", to: sessionId },
        orderBy: { createdAt: "desc" },
        select: { command: true },
      }),
      db.joinRequest.findMany({
        where: { sessionId, status: "PENDING" },
        select: { id: true, guestId: true },
        orderBy: { createdAt: "asc" },
      }),
      orderId
        ? db.order.findUnique({
            where: { id: orderId },
            include: { items: { include: { menuItem: { select: { name: true } } } } },
          })
        : Promise.resolve(null),
    ] as const);
  }

  /** Guest poll — single-session view used by the /track and /cart pages. */
  async guestPoll(sessionId: string, restaurantId: string) {
    const [session, orders, joinRequests] = await Promise.all([
      db.tableSession.findUnique({
        where: { id: sessionId },
        select: { id: true, status: true, guestCount: true, vipGuestId: true },
      }),
      db.order.findMany({
        where: { sessionId, restaurantId },
        include: {
          items: { include: { menuItem: { select: { name: true, image: true } } } },
        },
        orderBy: { createdAt: "asc" },
      }),
      db.joinRequest.findMany({
        where: { sessionId, status: "PENDING" },
      }),
    ]);
    return { session, orders, joinRequests };
  }
}
