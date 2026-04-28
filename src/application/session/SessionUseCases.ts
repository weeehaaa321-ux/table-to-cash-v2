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

  /** Cheap lookup of the assigned waiter for an open table session. */
  async findOpenSessionWaiter(tableNumber: number, restaurantId: string) {
    return db.tableSession.findFirst({
      where: { table: { number: tableNumber, restaurantId }, status: "OPEN" },
      select: { waiterId: true },
    });
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

  /** Active waiters whose shift matches the given list (e.g. current+0). */
  async listWaitersOnShifts(restaurantId: string, shifts: number[]) {
    return db.staff.findMany({
      where: { restaurantId, role: "WAITER", active: true, shift: { in: shifts } },
      orderBy: { createdAt: "asc" },
    });
  }

  /** Open sessions including their waiter's shift — used for shift-change reassignment. */
  async listOpenWithWaiterShift(restaurantId: string) {
    return db.tableSession.findMany({
      where: { restaurantId, status: "OPEN", waiterId: { not: null } },
      include: { waiter: { select: { id: true, shift: true } } },
    });
  }

  /** Sessions list for the dashboard: all OPEN sessions + sessions closed today. */
  async listOpenAndTodayClosed(restaurantId: string, todayStartUTC: Date) {
    return db.tableSession.findMany({
      where: {
        restaurantId,
        OR: [
          { status: "OPEN" },
          { closedAt: { gte: todayStartUTC } },
        ],
      },
      include: {
        table: { select: { number: true } },
        waiter: { select: { id: true, name: true } },
        vipGuest: { select: { name: true } },
        orders: {
          select: { id: true, orderNumber: true, total: true, status: true, paymentMethod: true, paidAt: true },
          orderBy: { createdAt: "asc" },
        },
      },
      orderBy: { openedAt: "desc" },
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
  async createVipSession(input: {
    restaurantId: string;
    guestCount: number;
    waiterId: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  /** Close a session, cancelling in-flight (or pending if VIP) orders.
   *
   * Table close: only cancel orders that haven't been consumed.
   * PENDING / CONFIRMED / PREPARING / READY → CANCELLED (kitchen
   * stops, or never started — food may be wasted but no customer
   * received it).
   * SERVED → leave alone. The customer ate the food. Cancelling
   * would erase a real event from the books; the owner's dashboard
   * would show the table as "never occupied" when in fact someone
   * walked out without paying. Bookkeeping reality beats a tidy
   * queue.
   * PAID → already revenue, untouched. */
  async closeWithCancellations(input: {
    sessionId: string;
    isVipSession: boolean;
  }) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const orderWhere: any = input.isVipSession
      ? { sessionId: input.sessionId, status: "PENDING" }
      : { sessionId: input.sessionId, status: { in: ["PENDING", "CONFIRMED", "PREPARING", "READY"] } };

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

  // ─── Pay-round flow (guest request + cashier confirm) ──────────
  /** Read session for guest pay-request — needs table info + restaurantId. */
  async findForPayRequest(sessionId: string) {
    return db.tableSession.findUnique({
      where: { id: sessionId },
      include: {
        table: { select: { number: true } },
        restaurant: { select: { id: true } },
      },
    });
  }

  /** Stamp paymentMethod on all unpaid open orders in the session. */
  async stampPendingPaymentMethod(sessionId: string, paymentMethod: string) {
    return db.order.updateMany({
      where: { sessionId, status: { notIn: ["PAID", "CANCELLED"] }, paidAt: null },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { paymentMethod: paymentMethod as any },
    });
  }

  async sumOpenTotal(sessionId: string): Promise<number> {
    const agg = await db.order.aggregate({
      where: { sessionId, status: { notIn: ["PAID", "CANCELLED"] } },
      _sum: { total: true },
    });
    const t = agg._sum.total;
    return t == null ? 0 : Number(t);
  }

  async listActiveCashiers(restaurantId: string) {
    return db.staff.findMany({
      where: { restaurantId, role: "CASHIER", active: true },
      select: { id: true },
    });
  }

  /** Guest cancels their pending payment request — only succeeds if no order has paidAt yet. */
  async cancelPaymentRequest(sessionId: string): Promise<
    | { ok: true; cleared: number }
    | { ok: false; reason: "PAYMENT_CONFIRMED" }
  > {
    const confirmed = await db.order.count({
      where: { sessionId, paidAt: { not: null } },
    });
    if (confirmed > 0) return { ok: false, reason: "PAYMENT_CONFIRMED" };
    const result = await db.order.updateMany({
      where: { sessionId, paidAt: null, paymentMethod: { not: null } },
      data: { paymentMethod: null },
    });
    return { ok: true, cleared: result.count };
  }

  async getSessionRestaurantScope(sessionId: string) {
    return db.tableSession.findUnique({
      where: { id: sessionId },
      select: { restaurantId: true },
    });
  }

  /**
   * Cashier confirms a pay round atomically. Tip goes to the first
   * order in the round. Returns the orders that were stamped + total.
   */
  async confirmPayRound(input: {
    sessionId: string;
    paymentMethod: string;
    tipAmount: number;
  }): Promise<
    | { noop: true; orders: never[]; confirmedTotal: 0 }
    | { noop: false; orders: Array<{ id: string; status: string; total: unknown }>; confirmedTotal: number; method: string }
  > {
    const { sessionId, paymentMethod, tipAmount } = input;
    return db.$transaction(async (tx) => {
      let orders = await tx.order.findMany({
        where: {
          sessionId,
          status: { notIn: ["PAID", "CANCELLED"] },
          paidAt: null,
          paymentMethod: { not: null },
        },
        select: { id: true, status: true, total: true },
      });
      if (orders.length === 0) {
        orders = await tx.order.findMany({
          where: {
            sessionId,
            status: { notIn: ["PAID", "CANCELLED"] },
            paidAt: null,
          },
          select: { id: true, status: true, total: true },
        });
      }
      if (orders.length === 0) {
        return { noop: true, orders: [] as never[], confirmedTotal: 0 } as const;
      }

      const now = new Date();
      const method = (paymentMethod || "CASH") as "CASH" | "CARD" | "INSTAPAY" | "APPLE_PAY" | "GOOGLE_PAY";
      const tipTargetId = orders[0]?.id;
      for (const order of orders) {
        const applyTip = order.id === tipTargetId && tipAmount > 0;
        if (order.status === "SERVED") {
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: "PAID",
              paymentMethod: method,
              paidAt: now,
              ...(applyTip ? { tip: { increment: tipAmount } } : {}),
            },
          });
        } else {
          await tx.order.update({
            where: { id: order.id },
            data: {
              paymentMethod: method,
              paidAt: now,
              ...(applyTip ? { tip: { increment: tipAmount } } : {}),
            },
          });
        }
      }

      const confirmedTotal = orders.reduce((sum, o) => sum + Number(o.total ?? 0), 0);
      return { noop: false, orders, confirmedTotal, method } as const;
    });
  }

  async countOpenUnpaid(sessionId: string): Promise<number> {
    return db.order.count({
      where: { sessionId, status: { notIn: ["PAID", "CANCELLED"] } },
    });
  }

  async findTableNumber(sessionId: string) {
    return db.tableSession.findUnique({
      where: { id: sessionId },
      select: { table: { select: { number: true } } },
    });
  }

  /**
   * Reverse the most-recent paid round on a session.
   * Returns the count + total of reversed orders; reopens the session
   * if it had been auto-closed; writes an audit Message.
   */
  async reverseLatestPayRound(input: {
    sessionId: string;
    actor: { id: string; name: string; restaurantId: string };
    reason?: string;
  }): Promise<
    | { noop: true; reversed: 0 }
    | { noop: false; reversed: number; totalReversed: number; reopened: boolean }
  > {
    const { sessionId, actor, reason } = input;
    return db.$transaction(async (tx) => {
      const latest = await tx.order.findFirst({
        where: { sessionId, paidAt: { not: null } },
        orderBy: { paidAt: "desc" },
        select: { paidAt: true },
      });
      if (!latest?.paidAt) {
        return { noop: true, reversed: 0 } as const;
      }

      const windowStart = new Date(latest.paidAt.getTime() - 1000);
      const windowEnd = new Date(latest.paidAt.getTime() + 1000);

      const affected = await tx.order.findMany({
        where: { sessionId, paidAt: { gte: windowStart, lte: windowEnd } },
        select: { id: true, status: true, total: true, paymentMethod: true },
      });

      for (const o of affected) {
        await tx.order.update({
          where: { id: o.id },
          data: {
            paidAt: null,
            paymentMethod: null,
            status: o.status === "PAID" ? "SERVED" : o.status,
          },
        });
      }

      const session = await tx.tableSession.findUnique({
        where: { id: sessionId },
        select: { status: true },
      });
      let reopened = false;
      if (session?.status === "CLOSED") {
        await tx.tableSession.update({
          where: { id: sessionId },
          data: { status: "OPEN", closedAt: null },
        });
        reopened = true;
      }

      const totalReversed = affected.reduce((s, o) => s + Number(o.total ?? 0), 0);
      await tx.message.create({
        data: {
          type: "command",
          from: actor.id,
          to: "owner",
          text: `${actor.name} reversed payment of ${Math.round(totalReversed)} EGP on session ${sessionId.slice(-8)}${reason ? ` — ${reason}` : ""}`,
          command: `payment_reversed:${sessionId}`,
          restaurantId: actor.restaurantId,
        },
      });

      return { noop: false, reversed: affected.length, totalReversed, reopened } as const;
    });
  }

  // ─── Payment-delegation (which guest pays) ──────
  async getRestaurantOfSession(sessionId: string) {
    return db.tableSession.findUnique({
      where: { id: sessionId },
      select: { restaurantId: true },
    });
  }

  async clearPaymentDelegations(sessionId: string) {
    return db.message.deleteMany({
      where: { type: "payment_delegate", to: sessionId },
    });
  }

  async addPaymentDelegation(sessionId: string, restaurantId: string, guestNumber: number | string) {
    return db.message.create({
      data: {
        type: "payment_delegate",
        from: "owner",
        to: sessionId,
        command: String(guestNumber),
        restaurantId,
      },
    });
  }

  async getPaymentDelegation(sessionId: string) {
    return db.message.findFirst({
      where: { type: "payment_delegate", to: sessionId },
      orderBy: { createdAt: "desc" },
      select: { command: true },
    });
  }

  // ─── Join-request flow ──────────────────────────
  async findPendingJoinRequest(sessionId: string, guestId: string) {
    return db.joinRequest.findFirst({
      where: { sessionId, guestId, status: "PENDING" },
    });
  }

  async findJoinRequestById(requestId: string) {
    return db.joinRequest.findUnique({ where: { id: requestId } });
  }

  async listPendingJoinRequests(sessionId: string) {
    return db.joinRequest.findMany({
      where: { sessionId, status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });
  }

  async setJoinRequestStatus(requestId: string, status: "APPROVED" | "REJECTED") {
    return db.joinRequest.update({
      where: { id: requestId },
      data: { status },
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
