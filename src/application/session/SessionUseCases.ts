// Session lifecycle — wraps legacy queries + db calls.
// Includes the multi-round payment, reverse, delegate, and join flows.

import { db } from "@/lib/db";
import { maybeCloseSession } from "@/lib/queries";
import { getCurrentShift, getShiftLabel, getShiftProgress } from "@/lib/shifts";
import { computeSessionRounds } from "@/lib/session-rounds";
import { nowInRestaurantTz } from "@/lib/restaurant-config";

const fullSessionInclude = {
  table: { select: { number: true } },
  orders: {
    include: { items: { include: { menuItem: { select: { name: true, image: true } } } } },
  },
  waiter: { select: { id: true, name: true } },
  vipGuest: { select: { name: true } },
};

const ordersOpenInclude = {
  table: { select: { number: true } },
  orders: {
    where: { status: { notIn: ["PAID", "CANCELLED"] } },
    include: { items: { include: { menuItem: { select: { name: true, image: true } } } } },
    orderBy: { createdAt: "desc" },
  },
  waiter: { select: { id: true, name: true } },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

export class SessionUseCases {
  async resolveRestaurantId(id: string): Promise<string | null> {
    if (!id) return null;
    if (id.startsWith("c") && id.length > 10) return id;
    const r = await db.restaurant.findUnique({
      where: { slug: id },
      select: { id: true },
    });
    return r?.id || null;
  }

  /** Lookup an open session for a table number. */
  async findOpenForTable(tableNumber: number, restaurantId: string) {
    const table = await db.table.findUnique({
      where: { restaurantId_number: { restaurantId, number: tableNumber } },
    });
    if (!table) return null;
    return db.tableSession.findFirst({
      where: { tableId: table.id, restaurantId, status: "OPEN" },
      include: ordersOpenInclude,
    });
  }

  /** Lookup by sessionId — preferred (survives table moves). */
  async findById(sessionId: string) {
    return db.tableSession.findUnique({
      where: { id: sessionId },
      include: ordersOpenInclude,
    });
  }

  /** Lookup an open VIP session by vipGuestId. */
  async findOpenForVip(vipGuestId: string, restaurantId: string) {
    return db.tableSession.findFirst({
      where: { vipGuestId, restaurantId, status: "OPEN" },
      include: {
        ...ordersOpenInclude,
        vipGuest: { select: { name: true } },
      },
    });
  }

  /** Lookup an open session for a vip-guest + orderType (used to reuse VIP sessions). */
  async findOpenVipByOrderType(
    vipGuestId: string,
    restaurantId: string,
    orderType: "VIP_DINE_IN" | "DELIVERY",
  ) {
    return db.tableSession.findFirst({
      where: { vipGuestId, restaurantId, orderType, status: "OPEN" },
      include: {
        waiter: { select: { id: true, name: true } },
        vipGuest: { select: { name: true } },
      },
    });
  }

  /** Look up table by (restaurantId, number). */
  async findTableByNumber(restaurantId: string, number: number) {
    return db.table.findUnique({
      where: { restaurantId_number: { restaurantId, number } },
    });
  }

  /** Active waiters for a shift — used by auto-assign. */
  async listActiveWaiters(restaurantId: string, shift: number) {
    return db.staff.findMany({
      where: { restaurantId, role: "WAITER", active: true, shift },
      orderBy: { createdAt: "asc" },
    });
  }

  /** Open-session counts grouped by waiter (for load-balancing). */
  async openSessionCountsByWaiter(restaurantId: string) {
    return db.tableSession.groupBy({
      by: ["waiterId"],
      where: { restaurantId, status: "OPEN", waiterId: { not: null } },
      _count: true,
    });
  }

  /** Last session opened by any waiter — for round-robin tiebreak. */
  async lastSessionWithWaiter(restaurantId: string) {
    return db.tableSession.findFirst({
      where: { restaurantId, waiterId: { not: null } },
      orderBy: { openedAt: "desc" },
      select: { waiterId: true },
    });
  }

  /** Create a regular table session, atomically closing any existing OPEN session. */
  async createTableSession(input: {
    tableId: string;
    restaurantId: string;
    guestCount: number;
    waiterId: string | null;
  }) {
    return db.$transaction(async (tx) => {
      await tx.tableSession.updateMany({
        where: { tableId: input.tableId, restaurantId: input.restaurantId, status: "OPEN" },
        data: { status: "CLOSED", closedAt: new Date() },
      });
      return tx.tableSession.create({
        data: {
          tableId: input.tableId,
          restaurantId: input.restaurantId,
          guestType: "walkin",
          guestCount: input.guestCount,
          waiterId: input.waiterId,
        },
        include: { waiter: { select: { id: true, name: true } } },
      });
    });
  }

  /** Create a VIP session (no table). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createVipSession(input: {
    restaurantId: string;
    guestCount: number;
    waiterId: string | null;
    orderType: any;
    vipGuestId: string | null;
  }) {
    return db.tableSession.create({
      data: {
        restaurantId: input.restaurantId,
        guestType: "vip",
        guestCount: input.guestCount,
        waiterId: input.waiterId,
        orderType: input.orderType,
        vipGuestId: input.vipGuestId,
      },
      include: {
        waiter: { select: { id: true, name: true } },
        vipGuest: { select: { name: true } },
      },
    });
  }

  /** Get session metadata only (orderType + vipGuestId) for branch decisions. */
  async getMeta(sessionId: string) {
    return db.tableSession.findUnique({
      where: { id: sessionId },
      select: { orderType: true, vipGuestId: true },
    });
  }

  /** Close a session, cancelling unpaid (or pending if VIP) orders. */
  async closeWithCancellations(input: {
    sessionId: string;
    isVipSession: boolean;
  }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orderWhere: any = input.isVipSession
      ? { sessionId: input.sessionId, status: "PENDING" }
      : { sessionId: input.sessionId, status: { notIn: ["PAID", "CANCELLED"] } };

    const orders = await db.order.findMany({ where: orderWhere, select: { id: true } });
    let cancelledCount = 0;
    if (orders.length > 0) {
      await db.order.updateMany({
        where: { id: { in: orders.map((o) => o.id) } },
        data: { status: "CANCELLED" },
      });
      await db.orderItem.updateMany({
        where: { orderId: { in: orders.map((o) => o.id) }, cancelled: false },
        data: {
          cancelled: true,
          cancelReason: input.isVipSession ? "VIP session closed" : "Session closed by manager",
          cancelledAt: new Date(),
        },
      });
      cancelledCount = orders.length;
    }
    const session = await db.tableSession.update({
      where: { id: input.sessionId },
      data: { status: "CLOSED", closedAt: new Date() },
      include: fullSessionInclude,
    });
    return { session, cancelledCount };
  }

  async incrementGuestCount(sessionId: string) {
    return db.tableSession.update({
      where: { id: sessionId },
      data: { guestCount: { increment: 1 } },
    });
  }

  async assignWaiter(sessionId: string, waiterId: string) {
    return db.tableSession.update({
      where: { id: sessionId },
      data: { waiterId },
      include: { table: { select: { number: true } } },
    });
  }

  async setMenuOpened(sessionId: string) {
    return db.tableSession.update({
      where: { id: sessionId },
      data: { menuOpenedAt: new Date() },
    });
  }

  /** Move a session to a different table — also moves its orders. */
  async changeTable(sessionId: string, newTableNumber: number) {
    const currentSession = await db.tableSession.findUnique({
      where: { id: sessionId },
      include: {
        table: { select: { number: true } },
        waiter: { select: { id: true, name: true } },
      },
    });
    if (!currentSession) return { error: "Session not found" as const };
    if (currentSession.orderType === "DELIVERY") return { error: "DELIVERY_NO_TABLE" as const };

    const newTable = await db.table.findUnique({
      where: {
        restaurantId_number: { restaurantId: currentSession.restaurantId, number: newTableNumber },
      },
    });
    if (!newTable) return { error: "Table not found" as const };

    const occupied = await db.tableSession.findFirst({
      where: { tableId: newTable.id, status: "OPEN" },
    });
    if (occupied) return { error: "Table is occupied" as const };

    const updated = await db.tableSession.update({
      where: { id: sessionId },
      data: { tableId: newTable.id },
    });
    await db.order.updateMany({
      where: { sessionId },
      data: { tableId: newTable.id },
    });
    return {
      ok: true as const,
      session: updated,
      currentSession,
      oldTableNumber: currentSession.table?.number ?? 0,
      newTableNumber,
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async update(id: string, data: any) {
    return db.tableSession.update({ where: { id }, data });
  }

  async maybeClose(sessionId: string) {
    return maybeCloseSession(sessionId);
  }

  async listAllOpen(restaurantId: string) {
    return db.tableSession.findMany({
      where: { restaurantId, status: "OPEN" },
      include: {
        table: { select: { number: true } },
        orders: { include: { items: true } },
      },
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createJoinRequest(data: any) {
    return db.joinRequest.create({ data });
  }

  async listJoinRequests(sessionId: string) {
    return db.joinRequest.findMany({
      where: { sessionId, status: "PENDING" },
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async updateJoinRequest(id: string, data: any) {
    return db.joinRequest.update({ where: { id }, data });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async payRound(input: { sessionId: string; paymentMethod: string; tip?: number; orderIds?: string[] }): Promise<any> {
    const where = input.orderIds && input.orderIds.length > 0
      ? { id: { in: input.orderIds } }
      : { sessionId: input.sessionId, paidAt: null };
    return db.order.updateMany({
      where,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { paymentMethod: input.paymentMethod as any, paidAt: new Date() },
    });
  }

  async reversePayment(orderIds: string[]) {
    return db.order.updateMany({
      where: { id: { in: orderIds } },
      data: { paymentMethod: null, paidAt: null },
    });
  }

  async delegateWaiter(sessionId: string, newWaiterId: string) {
    return db.tableSession.update({
      where: { id: sessionId },
      data: { waiterId: newWaiterId },
    });
  }

  // ─── Time / shift helpers ───────────────────────
  currentShift(): 1 | 2 | 3 { return getCurrentShift(); }
  shiftLabel(s: 1 | 2 | 3): string { return getShiftLabel(s); }
  shiftProgress(): number { return getShiftProgress(); }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  computeRounds(orders: any[]): any { return computeSessionRounds(orders); }
  nowInTz(): Date { return nowInRestaurantTz(); }
}
