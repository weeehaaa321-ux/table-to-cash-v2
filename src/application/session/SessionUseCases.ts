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
          select: {
            id: true, orderNumber: true, total: true, status: true, paymentMethod: true, paidAt: true, tip: true, guestNumber: true, guestName: true,
            items: {
              where: { cancelled: false },
              select: {
                quantity: true,
                price: true,
                addOns: true,
                notes: true,
                comped: true,
                menuItem: { select: { name: true, nameAr: true } },
              },
            },
          },
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

  /**
   * Create a regular table session.
   *
   * Race-safe: if two guests scan simultaneously, both POSTs land
   * here in parallel. The flow is now:
   *   1. Take a per-table advisory lock so the two transactions
   *      serialise.
   *   2. Look for an existing OPEN session on this table.
   *   3. If one exists, return it (the second guest's scan is
   *      treated as "join the same table" — the join-request UX
   *      on the client takes over from there).
   *   4. Otherwise, create a fresh session.
   *
   * The earlier behaviour — `updateMany(close existing) + create`
   * — was intentional for force-replacing an orphaned/stuck OPEN
   * session, but it also meant two real simultaneous scans each
   * closed the other's just-created session, leaving guests on
   * unmanaged closed sessions. The partial unique index on
   * `TableSession(tableId) WHERE status='OPEN'` is the
   * belt-and-braces backstop: if anything bypasses this code path,
   * the DB still refuses a second OPEN row.
   *
   * Stuck-session recovery now happens via the auto-clockout cron
   * (which closes sessions that have been idle for hours) or via
   * a floor-manager force-close action — never by silently
   * stomping on whatever was there during a fresh scan.
   */
  async createTableSession(input: {
    tableId: string;
    restaurantId: string;
    guestCount: number;
    waiterId: string | null;
    // The guest's browser-side identity. When the session is created
    // by a guest scan (autoStart), we stamp them as the owner inside
    // the same transaction by writing an APPROVED JoinRequest. That
    // owner record is the ground-truth marker subsequent scanners
    // check against before deciding whether they should be claimed
    // as owner or routed through the join-request flow. Waiter-
    // opened sessions pass null here, leaving the seat open so the
    // first guest to scan claims it.
    ownerGuestId?: string | null;
  }) {
    return db.$transaction(async (tx) => {
      // Namespace 2: per-table lock. Distinct from the per-session
      // (1) and per-restaurant (0) lock spaces so paths can't
      // accidentally serialise against each other.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.tableId}, 2))`;

      const existing = await tx.tableSession.findFirst({
        where: {
          tableId: input.tableId,
          restaurantId: input.restaurantId,
          status: "OPEN",
        },
        include: { waiter: { select: { id: true, name: true } } },
      });
      if (existing) {
        // Returning a session opened by someone else (likely a waiter
        // pre-seating the table). If this caller has a guestId AND
        // no owner has been claimed yet, register them as the owner
        // here so the next scanner is correctly routed through join-
        // request instead of being auto-claimed too.
        if (input.ownerGuestId) {
          const anyApproved = await tx.joinRequest.findFirst({
            where: { sessionId: existing.id, status: "APPROVED" },
            select: { id: true },
          });
          if (!anyApproved) {
            await tx.joinRequest.create({
              data: { sessionId: existing.id, guestId: input.ownerGuestId, status: "APPROVED" },
            });
          }
        }
        return existing;
      }

      const created = await tx.tableSession.create({
        data: {
          tableId: input.tableId,
          restaurantId: input.restaurantId,
          guestType: "walkin",
          guestCount: input.guestCount,
          waiterId: input.waiterId,
        },
        include: { waiter: { select: { id: true, name: true } } },
      });
      if (input.ownerGuestId) {
        await tx.joinRequest.create({
          data: { sessionId: created.id, guestId: input.ownerGuestId, status: "APPROVED" },
        });
      }
      return created;
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
    return db.$transaction(async (tx) => {
      // Per-session lock. Pairs with the lock taken by createOrder,
      // confirmPayRound, changeTable, and maybeCloseSession — so a
      // POST /api/orders for this session waits for our close to
      // commit (rather than landing a fresh PENDING order on a
      // session we're about to mark CLOSED).
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.sessionId}, 1))`;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const orderWhere: any = input.isVipSession
        ? { sessionId: input.sessionId, status: "PENDING" }
        : { sessionId: input.sessionId, status: { in: ["PENDING", "CONFIRMED", "PREPARING", "READY"] } };

      const orders = await tx.order.findMany({ where: orderWhere, select: { id: true } });
      let cancelledCount = 0;
      if (orders.length > 0) {
      // Zero everything money-shaped on the cancelled rows. If a guest
      // had tapped "Pay X" before this close fires, the order would
      // otherwise stay tagged with paymentMethod + tip on a CANCELLED
      // row, and downstream aggregations that filter on paymentMethod
      // (cashTotal, ledger views) would falsely pick it up.
      await tx.order.updateMany({
        where: { id: { in: orders.map((o) => o.id) } },
        data: { status: "CANCELLED", paymentMethod: null, tip: 0 },
      });
      await tx.orderItem.updateMany({
        where: { orderId: { in: orders.map((o) => o.id) }, cancelled: false },
        data: {
          cancelled: true,
          cancelReason: input.isVipSession ? "VIP session closed" : "Session closed by manager",
          cancelledAt: new Date(),
        },
      });
      cancelledCount = orders.length;
    }
    const session = await tx.tableSession.update({
      where: { id: input.sessionId },
      data: { status: "CLOSED", closedAt: new Date() },
      include: fullSessionInclude,
    });
    return { session, cancelledCount };
    });
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

  /**
   * Move a session to a different table — also moves its orders.
   *
   * Wrapped in a transaction with both the moving session's lock
   * AND the destination table's lock. Without those locks, a guest
   * scanning the destination table mid-move could open a new
   * OPEN session there and we'd land two OPENs on the same
   * tableId. The partial unique index would catch that as P2002,
   * but doing it inside the transaction means we fail cleanly
   * with "Table is occupied" instead of 500.
   */
  async changeTable(sessionId: string, newTableNumber: number) {
    return db.$transaction(async (tx) => {
      // Lock this session first, in the same namespace every other
      // session-mutating path uses, so concurrent close/pay-confirm
      // serialise behind us.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${sessionId}, 1))`;

      const currentSession = await tx.tableSession.findUnique({
        where: { id: sessionId },
        include: {
          table: { select: { number: true } },
          waiter: { select: { id: true, name: true } },
        },
      });
      if (!currentSession) return { error: "Session not found" as const };
      if (currentSession.orderType === "DELIVERY") return { error: "DELIVERY_NO_TABLE" as const };

      const newTable = await tx.table.findUnique({
        where: {
          restaurantId_number: { restaurantId: currentSession.restaurantId, number: newTableNumber },
        },
      });
      if (!newTable) return { error: "Table not found" as const };

      // Lock the destination table so a parallel scan can't open a
      // new session on it between our occupancy check and our move.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${newTable.id}, 2))`;

      const occupied = await tx.tableSession.findFirst({
        where: { tableId: newTable.id, status: "OPEN" },
      });
      if (occupied) return { error: "Table is occupied" as const };

      const updated = await tx.tableSession.update({
        where: { id: sessionId },
        data: { tableId: newTable.id },
      });
      await tx.order.updateMany({
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
    });
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

  /**
   * Stamp paymentMethod on all unpaid open orders in the session, and
   * the guest-selected tip on the first unpaid order. The tip lives on
   * a single order so the cashier's confirm step can replace it
   * cleanly without double-counting (and so summarising tip via
   * `sum(tip)` over the round still produces the right number).
   */
  async stampPendingPaymentMethod(
    sessionId: string,
    paymentMethod: string,
    tipAmount: number = 0,
  ) {
    await db.order.updateMany({
      where: { sessionId, status: { notIn: ["PAID", "CANCELLED"] }, paidAt: null },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { paymentMethod: paymentMethod as any, tip: 0 },
    });
    if (tipAmount > 0) {
      const firstUnpaid = await db.order.findFirst({
        where: { sessionId, status: { notIn: ["PAID", "CANCELLED"] }, paidAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true },
      });
      if (firstUnpaid) {
        await db.order.update({
          where: { id: firstUnpaid.id },
          data: { tip: Math.round(tipAmount) },
        });
      }
    }
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

  /**
   * Guest cancels their pending payment request. Only the *current*
   * round's pending stamp is touched (orders with paymentMethod set
   * and paidAt still null). Previously-paid rounds are untouched.
   *
   * The earlier implementation refused the cancel if ANY order in
   * the session had paidAt set — which meant the moment a session
   * had a settled round 1, the cancel button in round 2 silently
   * 409'd as PAYMENT_CONFIRMED and looked broken to the guest.
   *
   * If updateMany clears nothing, the request had already been
   * confirmed (or never existed) — either way the guest's UI is
   * about to refresh from the next poll, so we return ok with
   * cleared=0 and let the live state speak for itself.
   */
  async cancelPaymentRequest(sessionId: string): Promise<
    | { ok: true; cleared: number }
  > {
    const result = await db.order.updateMany({
      where: { sessionId, paidAt: null, paymentMethod: { not: null } },
      // Reset both the chosen method AND the guest's pre-stamped tip.
      // Without the tip reset, a tip the guest typed then cancelled
      // would silently linger and show up on the cashier's pre-fill
      // the next time they tapped Pay.
      data: { paymentMethod: null, tip: 0 },
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
      // Per-session lock so a fresh order POST or a session close
      // can't race the settle. Without this, a guest placing
      // round-2 milliseconds before this confirm could either land
      // their order on the just-paid round, or miss being included
      // in maybeCloseSession's "all paid?" check.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${sessionId}, 1))`;

      let orders = await tx.order.findMany({
        where: {
          sessionId,
          status: { notIn: ["PAID", "CANCELLED"] },
          paidAt: null,
          paymentMethod: { not: null },
        },
        orderBy: { createdAt: "asc" },
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
      // SET tip (not increment) — the cashier's input is the
      // authoritative value at confirm time. The guest may have
      // pre-stamped a tip when they tapped "Pay X EGP" on /track;
      // the cashier sees that pre-fill and can adjust. Incrementing
      // here would compound the two values into double the tip.
      for (const order of orders) {
        const isTipTarget = order.id === tipTargetId;
        if (order.status === "SERVED") {
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: "PAID",
              paymentMethod: method,
              paidAt: now,
              ...(isTipTarget ? { tip: Math.max(0, Math.round(tipAmount)) } : { tip: 0 }),
            },
          });
        } else {
          await tx.order.update({
            where: { id: order.id },
            data: {
              paymentMethod: method,
              paidAt: now,
              ...(isTipTarget ? { tip: Math.max(0, Math.round(tipAmount)) } : { tip: 0 }),
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
            // Reset the tip too — leaving a tip > 0 on a row with
            // paidAt = null is an invariant violation. The next
            // confirmPayRound will SET tip from the cashier's input,
            // so this is purely hygiene.
            tip: 0,
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

  // Returns the most recent non-rejected request so a guest who closed
  // their tab after approval (or before polling caught it) is recognized
  // on re-scan instead of being forced through the join flow again.
  async findExistingJoinRequest(sessionId: string, guestId: string) {
    return db.joinRequest.findFirst({
      where: { sessionId, guestId, status: { in: ["PENDING", "APPROVED"] } },
      orderBy: { createdAt: "desc" },
    });
  }

  // Atomic claim-or-join. Used by the /scan flow when a guest lands on
  // a table that already has an OPEN session. Behaviour:
  //
  //   • Guest already has a PENDING/APPROVED record → echo it back so
  //     a returning tab walks straight in (or keeps waiting) instead of
  //     stacking duplicate requests.
  //   • No APPROVED record exists for the session AND no orders have
  //     been placed → treat the session as "owner-less" (e.g. a waiter
  //     pre-seated the table from their device). Auto-claim this guest
  //     as the owner so they can enter, place orders, and approve the
  //     next scanner — without that, every guest hits "Ask Guest #1 to
  //     let you in" but no Guest #1 client exists to approve.
  //   • Otherwise → create a PENDING request for the existing owner to
  //     approve. The "owner" is whoever holds the earliest APPROVED
  //     record (we don't track role explicitly on JoinRequest).
  //
  // Wrapped in a transaction with the per-session advisory lock so two
  // simultaneous first scanners can't both be promoted to owner.
  async claimOrJoinSession(sessionId: string, guestId: string): Promise<{
    id: string;
    status: "approved" | "pending";
    role: "owner" | "member";
  }> {
    return db.$transaction(async (tx) => {
      // Namespace 1: per-session lock. Same space the rest of the
      // session-mutating paths use.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${sessionId}, 1))`;

      const earliestApproved = await tx.joinRequest.findFirst({
        where: { sessionId, status: "APPROVED" },
        orderBy: { createdAt: "asc" },
        select: { id: true, guestId: true },
      });

      const existing = await tx.joinRequest.findFirst({
        where: { sessionId, guestId, status: { in: ["PENDING", "APPROVED"] } },
        orderBy: { createdAt: "desc" },
      });
      if (existing) {
        const isOwner = existing.status === "APPROVED" && earliestApproved?.id === existing.id;
        return {
          id: existing.id,
          status: existing.status === "APPROVED" ? "approved" : "pending",
          role: isOwner ? "owner" : "member",
        };
      }

      if (!earliestApproved) {
        // No client has been registered as owner yet. Guard against the
        // legacy case where a guest-created session predates owner-
        // stamping (no APPROVED record but a real client guest is
        // already actively using the table) by checking menuOpenedAt.
        // That field is only set when a guest browser hits the menu
        // page (ImmersiveMenu → POST /api/sessions menu_opened) — staff
        // flows (waiter Seat, dashboard assign, floor manager) never
        // trigger it. So menuOpenedAt === null is a reliable "no client
        // guest has joined yet" signal that survives the case where
        // staff pre-placed orders before the first guest scanned (the
        // earlier orderCount === 0 guard mis-handled that case and
        // left the guest stuck on "Ask Guest #1").
        const session = await tx.tableSession.findUnique({
          where: { id: sessionId },
          select: { menuOpenedAt: true },
        });
        if (session && session.menuOpenedAt === null) {
          const claim = await tx.joinRequest.create({
            data: { sessionId, guestId, status: "APPROVED" },
          });
          return { id: claim.id, status: "approved", role: "owner" };
        }
      }

      const pending = await tx.joinRequest.create({
        data: { sessionId, guestId, status: "PENDING" },
      });
      return { id: pending.id, status: "pending", role: "member" };
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
