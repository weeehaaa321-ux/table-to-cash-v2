// Session lifecycle — wraps legacy queries + db calls.
// Includes the multi-round payment, reverse, delegate, and join flows.

import { db } from "@/lib/db";
import { maybeCloseSession } from "@/lib/queries";
import { getCurrentShift, getShiftLabel, getShiftProgress } from "@/lib/shifts";
import { computeSessionRounds } from "@/lib/session-rounds";
import { nowInRestaurantTz } from "@/lib/restaurant-config";
import type { Prisma } from "@/generated/prisma/client";

// Merge a split-off Order back into its parent and delete the split.
// Used by cancelPaymentRequest and reverseLatestPayRound: when a
// split-off Order's pay attempt is undone, leaving it as a dangling
// unpaid Order would poison the bill (the parent is already missing
// those items but they weren't actually paid for either). Returning
// the items to the parent restores the original bill shape.
async function mergeSplitBackIntoParent(
  tx: Prisma.TransactionClient,
  splitOrderId: string,
  parentOrderId: string,
) {
  const parent = await tx.order.findUnique({
    where: { id: parentOrderId },
    include: {
      items: {
        where: { cancelled: false },
        select: { id: true, price: true, quantity: true, comped: true },
      },
    },
  });
  if (!parent) {
    // Parent has been deleted (rare — closed session cleanup, etc).
    // Leave the split as-is rather than orphaning items into a void.
    return;
  }

  // Move all items back onto the parent.
  await tx.orderItem.updateMany({
    where: { orderId: splitOrderId },
    data: { orderId: parentOrderId },
  });

  // Recompute parent totals from the union of remaining + returned items.
  const merged = await tx.order.findUnique({
    where: { id: parentOrderId },
    include: {
      items: {
        where: { cancelled: false },
        select: { price: true, quantity: true, comped: true },
      },
    },
  });
  const subtotal = (merged?.items ?? []).reduce(
    (s, i) => s + (i.comped ? 0 : Number(i.price) * i.quantity), 0,
  );
  await tx.order.update({
    where: { id: parentOrderId },
    data: {
      subtotal,
      total: subtotal + Number(parent.tax) + Number(parent.deliveryFee),
    },
  });

  // Drop the now-empty split-off row.
  await tx.order.delete({ where: { id: splitOrderId } });
}

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

// Cache of (restaurantId → serviceModel + chargePercent). The flag
// is read on nearly every session-mutating request, so we keep a
// 30-second in-memory cache to avoid hammering the DB. Owner toggles
// from the dashboard call invalidateServiceModelCache() so the change
// propagates within ~30s in the worst case (instantly when the cache
// is colder than that).
type ServiceModelCfg = { serviceModel: "WAITER" | "RUNNER"; serviceChargePercent: number };
const serviceModelCache = new Map<string, { value: ServiceModelCfg; ts: number }>();
const SERVICE_MODEL_TTL_MS = 30_000;

export function invalidateServiceModelCache(restaurantId?: string) {
  if (restaurantId) serviceModelCache.delete(restaurantId);
  else serviceModelCache.clear();
}

export async function readServiceModel(restaurantId: string): Promise<ServiceModelCfg> {
  const hit = serviceModelCache.get(restaurantId);
  if (hit && Date.now() - hit.ts < SERVICE_MODEL_TTL_MS) return hit.value;
  const r = await db.restaurant.findUnique({
    where: { id: restaurantId },
    select: { serviceModel: true, serviceChargePercent: true },
  });
  const value: ServiceModelCfg = {
    serviceModel: (r?.serviceModel as "WAITER" | "RUNNER") || "WAITER",
    serviceChargePercent: r?.serviceChargePercent ? Number(r.serviceChargePercent) : 0,
  };
  serviceModelCache.set(restaurantId, { value, ts: Date.now() });
  return value;
}

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
            id: true, orderNumber: true, total: true, status: true, paymentMethod: true, paidAt: true, tip: true, discount: true, serviceCharge: true, guestNumber: true, guestName: true,
            items: {
              where: { cancelled: false },
              select: {
                id: true,
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

  /** Get session metadata only (orderType + vipGuestId + restaurantId)
   * for branch decisions in route handlers (e.g. service-model gates). */
  async getMeta(sessionId: string) {
    return db.tableSession.findUnique({
      where: { id: sessionId },
      select: { orderType: true, vipGuestId: true, restaurantId: true },
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

  /**
   * Verify a guest is the approved owner of a session. Used to gate
   * guest self-actions (e.g. their own change-table) without requiring
   * staff credentials. Returns true only when the JoinRequest table
   * carries an APPROVED row for this (sessionId, guestId) pair.
   */
  async isSessionOwnerGuest(sessionId: string, guestId: string): Promise<boolean> {
    if (!sessionId || !guestId) return false;
    const row = await db.joinRequest.findFirst({
      where: { sessionId, guestId, status: "APPROVED" },
      select: { id: true },
    });
    return !!row;
  }

  /**
   * Move a single guest (identified by guestNumber, or by guestName as
   * a fallback) and ALL of their orders — placed, served, or paid —
   * from one table session to another. Used when one member of a group
   * decides to switch tables mid-night.
   *
   * Rules:
   *   - Source session stays open (it may still have other guests).
   *   - Paid orders stay paid; their paidAt is unchanged. Revenue stays
   *     correctly attributed to whoever was waiting that table at pay-
   *     time, and merging into the new table doesn't reset their bill.
   *   - Target session is auto-resolved at the new table:
   *       · existing OPEN session at that table  → join it
   *       · no session yet                       → create a fresh one
   *   - GuestNumber collisions are avoided: the moved orders get the
   *     next free guestNumber in the target session (so a "Guest 1" who
   *     joins another "Guest 1"'s table becomes Guest 2/3/etc there).
   *   - A guest with no matched orders (typo, already moved) → 404.
   *
   * Returns enough info for the route to push notifications.
   */
  async moveGuestToTable(input: {
    sessionId: string;
    guestNumber?: number | null;
    guestName?: string | null;
    targetTableNumber: number;
    waiterIdForNewSession?: string | null;
  }) {
    const { sessionId, guestNumber, guestName, targetTableNumber } = input;
    return db.$transaction(async (tx) => {
      // Lock source session first so a concurrent payment / split / move
      // can't race us. Same lock namespace (1) every other session
      // mutator uses.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${sessionId}, 1))`;

      const source = await tx.tableSession.findUnique({
        where: { id: sessionId },
        include: {
          table: { select: { number: true } },
          waiter: { select: { id: true, name: true } },
        },
      });
      if (!source) return { error: "Session not found" as const };
      if (source.orderType === "DELIVERY") return { error: "DELIVERY_NO_TABLE" as const };

      // Find the target table.
      const targetTable = await tx.table.findUnique({
        where: {
          restaurantId_number: { restaurantId: source.restaurantId, number: targetTableNumber },
        },
      });
      if (!targetTable) return { error: "Target table not found" as const };

      // Lock the target table — same as changeTable. Prevents a parallel
      // scan from opening a new OPEN session on it between our find and
      // our create.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${targetTable.id}, 2))`;

      // Find or create the target session. Don't move into the SAME
      // session we started in — that's a no-op that would loop in the
      // collision-avoidance loop below.
      let target = await tx.tableSession.findFirst({
        where: { tableId: targetTable.id, status: "OPEN" },
        include: {
          table: { select: { number: true } },
          waiter: { select: { id: true, name: true } },
        },
      });
      if (target && target.id === sessionId) {
        return { error: "Already at this table" as const };
      }
      // Track whether we created the target ourselves so the guestCount
      // increment below knows not to double-count a session we just
      // initialised with guestCount=1.
      let targetWasCreated = false;
      if (!target) {
        const created = await tx.tableSession.create({
          data: {
            tableId: targetTable.id,
            restaurantId: source.restaurantId,
            guestType: "walkin",
            guestCount: 1,
            // Default to source's waiter so the kitchen-side waiter
            // assignment doesn't churn. The floor manager can reassign
            // afterwards if the new table belongs to a different section.
            waiterId: input.waiterIdForNewSession ?? source.waiterId ?? null,
          },
          include: {
            table: { select: { number: true } },
            waiter: { select: { id: true, name: true } },
          },
        });
        target = created;
        targetWasCreated = true;
      }

      // Match the guest's orders. Prefer guestNumber when given (it's
      // the canonical per-session identifier the cart writes); fall
      // back to guestName for legacy rows or walk-in tags.
      const orderMatch: Prisma.OrderWhereInput = { sessionId };
      const matchClauses: Prisma.OrderWhereInput[] = [];
      if (guestNumber != null) matchClauses.push({ guestNumber });
      if (guestName && guestName.trim()) matchClauses.push({ guestName: guestName.trim() });
      if (matchClauses.length === 0) return { error: "Missing guest identifier" as const };
      orderMatch.OR = matchClauses;

      const movingOrders = await tx.order.findMany({
        where: orderMatch,
        select: { id: true, guestNumber: true, guestName: true, status: true, paidAt: true },
      });
      if (movingOrders.length === 0) return { error: "Guest not found on source table" as const };

      // Find the next free guestNumber on the target side. A target
      // session that already has Guests 1, 2, 3 means the moving guest
      // becomes Guest 4 there.
      const targetGuestRows = await tx.order.findMany({
        where: { sessionId: target.id, guestNumber: { not: null } },
        select: { guestNumber: true },
      });
      const usedNumbers = new Set<number>();
      for (const r of targetGuestRows) {
        if (r.guestNumber != null) usedNumbers.add(r.guestNumber);
      }
      let nextGuest = 1;
      while (usedNumbers.has(nextGuest)) nextGuest += 1;

      // Move all the matched orders. Update tableId so the kitchen / waiter
      // pages route correctly, sessionId so the bill aggregates with the
      // target session's other rounds, and guestNumber so the floor view
      // labels them under their new slot. guestName is preserved as a
      // soft label.
      await tx.order.updateMany({
        where: { id: { in: movingOrders.map((o) => o.id) } },
        data: {
          sessionId: target.id,
          tableId: targetTable.id,
          guestNumber: nextGuest,
        },
      });

      // Bump target guestCount when this is a brand-new guest there.
      // Skip the bump entirely when WE just created the target with
      // guestCount=1 — that initial 1 already accounts for the moving
      // guest, and incrementing again would land at 2 with one warm
      // body. Otherwise, only count when at least one moved order was
      // unpaid (paid-only carryovers — e.g. their bill follows them
      // but they themselves haven't ordered anything new yet — don't
      // change live occupancy).
      const hasUnpaidMove = movingOrders.some((o) => !o.paidAt);
      if (!targetWasCreated && hasUnpaidMove) {
        await tx.tableSession.update({
          where: { id: target.id },
          data: { guestCount: { increment: 1 } },
        });
      }

      return {
        ok: true as const,
        sourceSession: source,
        targetSession: target,
        sourceTableNumber: source.table?.number ?? 0,
        targetTableNumber,
        movedOrderIds: movingOrders.map((o) => o.id),
        newGuestNumber: nextGuest,
        guestLabel: guestName?.trim() || (guestNumber != null ? `Guest ${guestNumber}` : "Guest"),
      };
    });
  }

  /**
   * Merge two table sessions: source session is folded into target
   * session, then the source is closed. Used when two adjacent groups
   * decide to combine — e.g. table 2 walks over to join table 1 for
   * the rest of the night.
   *
   * Rules:
   *   - Both sessions must be OPEN and live at the same restaurant.
   *   - Neither side can be DELIVERY or VIP_DINE_IN — those don't
   *     have a table the way merge expects.
   *   - All source orders move to the target session and its table.
   *     Paid orders stay paid (paidAt preserved); revenue stays
   *     correctly attributed to who served them.
   *   - GuestNumber collisions: source guests are renumbered above
   *     the highest guestNumber in target so each former guest stays
   *     a distinct row in the merged bill.
   *   - Target's guestCount is incremented by the source's guestCount.
   *   - Source is then closed (closedAt = now). Closing-vs-deleting:
   *     we close so the move is auditable — a manager can see the
   *     source session in the day's history and trace who merged.
   */
  async mergeTables(sourceSessionId: string, targetSessionId: string) {
    if (sourceSessionId === targetSessionId) {
      return { error: "Cannot merge a session into itself" as const };
    }
    return db.$transaction(async (tx) => {
      // Lock both sessions in a deterministic order to avoid deadlock
      // when two managers call mergeTables(A,B) and mergeTables(B,A)
      // concurrently. Smaller-id-first is our convention.
      const [first, second] = [sourceSessionId, targetSessionId].sort();
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${first}, 1))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${second}, 1))`;

      const source = await tx.tableSession.findUnique({
        where: { id: sourceSessionId },
        include: { table: { select: { number: true } } },
      });
      const target = await tx.tableSession.findUnique({
        where: { id: targetSessionId },
        include: {
          table: { select: { number: true } },
          waiter: { select: { id: true, name: true } },
        },
      });
      if (!source) return { error: "Source session not found" as const };
      if (!target) return { error: "Target session not found" as const };
      if (source.status !== "OPEN") return { error: "Source session not open" as const };
      if (target.status !== "OPEN") return { error: "Target session not open" as const };
      if (source.restaurantId !== target.restaurantId) {
        return { error: "Sessions belong to different restaurants" as const };
      }
      if (source.orderType !== "TABLE" || target.orderType !== "TABLE") {
        return { error: "Only TABLE sessions can be merged" as const };
      }
      if (!target.tableId) return { error: "Target session has no table" as const };

      // Find the highest guestNumber on the target so we can shift the
      // source's guests above it.
      const targetGuestRows = await tx.order.findMany({
        where: { sessionId: target.id, guestNumber: { not: null } },
        select: { guestNumber: true },
      });
      const targetMax = targetGuestRows.reduce(
        (m, r) => (r.guestNumber != null && r.guestNumber > m ? r.guestNumber : m),
        0,
      );

      // Re-number source guests in-place. Each distinct source
      // guestNumber maps to (targetMax + that number) so the relative
      // ordering between source guests is preserved on the merged bill.
      const sourceGuestRows = await tx.order.findMany({
        where: { sessionId: source.id, guestNumber: { not: null } },
        select: { id: true, guestNumber: true },
      });
      const distinctSourceGuests = new Set<number>();
      for (const r of sourceGuestRows) {
        if (r.guestNumber != null) distinctSourceGuests.add(r.guestNumber);
      }
      // Update each source guestNumber to its shifted value.
      for (const oldNum of distinctSourceGuests) {
        const newNum = targetMax + oldNum;
        await tx.order.updateMany({
          where: { sessionId: source.id, guestNumber: oldNum },
          data: { guestNumber: newNum },
        });
      }

      // Move every source order onto the target session + table.
      await tx.order.updateMany({
        where: { sessionId: source.id },
        data: { sessionId: target.id, tableId: target.tableId },
      });

      // Combine guestCounts. Source's count represents the people who
      // walked over to the target.
      await tx.tableSession.update({
        where: { id: target.id },
        data: { guestCount: { increment: source.guestCount } },
      });

      // Close the source session. closedAt + status mirror the same
      // closure the cashier path writes, so daily-close / dashboard
      // queries treat it like any other resolved session.
      const closedSource = await tx.tableSession.update({
        where: { id: source.id },
        data: { status: "CLOSED", closedAt: new Date() },
      });

      // Move any pending join requests to the target so guest devices
      // following the source token still find their bill.
      await tx.joinRequest.updateMany({
        where: { sessionId: source.id, status: { in: ["APPROVED", "PENDING"] } },
        data: { sessionId: target.id },
      });

      const refreshedTarget = await tx.tableSession.findUnique({
        where: { id: target.id },
        include: {
          table: { select: { number: true } },
          waiter: { select: { id: true, name: true } },
        },
      });

      return {
        ok: true as const,
        source: closedSource,
        target: refreshedTarget!,
        sourceTableNumber: source.table?.number ?? 0,
        targetTableNumber: target.table?.number ?? 0,
        mergedGuestCount: source.guestCount,
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
    // Optional: restrict to a specific subset of unpaid orders. Used by
    // the split-pay flow — splitOrderForPayment returns the Orders the
    // guest is paying on, and we stamp only those (so a different guest's
    // unpaid orders aren't accidentally pulled into this round).
    orderIds?: string[],
  ) {
    const scope = orderIds && orderIds.length > 0
      ? { sessionId, status: { notIn: ["PAID", "CANCELLED"] as ("PAID" | "CANCELLED")[] }, paidAt: null, id: { in: orderIds } }
      : { sessionId, status: { notIn: ["PAID", "CANCELLED"] as ("PAID" | "CANCELLED")[] }, paidAt: null };
    await db.order.updateMany({
      where: scope,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { paymentMethod: paymentMethod as any, tip: 0 },
    });
    if (tipAmount > 0) {
      const firstUnpaid = await db.order.findFirst({
        where: scope,
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

  async sumOpenTotal(sessionId: string, orderIds?: string[]): Promise<number> {
    const agg = await db.order.aggregate({
      where: orderIds && orderIds.length > 0
        ? { sessionId, status: { notIn: ["PAID", "CANCELLED"] }, id: { in: orderIds } }
        : { sessionId, status: { notIn: ["PAID", "CANCELLED"] } },
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
    return db.$transaction(async (tx) => {
      // Per-session lock so a fresh confirm or split can't race the
      // merge-back below.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${sessionId}, 1))`;

      // Snapshot the orders that are about to be unstamped so we can
      // identify split-offs that should be merged back into their
      // parents. Anything with parentOrderId set was created by the
      // split-pay flow — leaving it as a dangling unpaid Order would
      // pollute the bill with an orphan row that nobody asked for.
      const stamped = await tx.order.findMany({
        where: { sessionId, paidAt: null, paymentMethod: { not: null } },
        select: { id: true, parentOrderId: true },
      });

      const result = await tx.order.updateMany({
        where: { sessionId, paidAt: null, paymentMethod: { not: null } },
        // Reset both the chosen method AND the guest's pre-stamped tip.
        // Without the tip reset, a tip the guest typed then cancelled
        // would silently linger and show up on the cashier's pre-fill
        // the next time they tapped Pay.
        data: { paymentMethod: null, tip: 0 },
      });

      const splitsToMerge = stamped.filter((o) => o.parentOrderId);
      for (const split of splitsToMerge) {
        await mergeSplitBackIntoParent(tx, split.id, split.parentOrderId!);
      }

      return { ok: true, cleared: result.count };
    });
  }

  async getSessionRestaurantScope(sessionId: string) {
    return db.tableSession.findUnique({
      where: { id: sessionId },
      select: { restaurantId: true },
    });
  }

  /**
   * Split a session's unpaid orders for partial payment.
   *
   * Given a list of itemIds (a strict subset of unpaid items in the
   * session), peel those items into newly-created split-off Orders
   * and recompute totals on the original parents. Returns the set of
   * Orders whose items the caller is paying for — the existing
   * stampPendingPaymentMethod / confirmPayRound flow then operates on
   * those Orders unchanged.
   *
   * Rules:
   *   • Only SERVED items can be split. Splitting before food is
   *     delivered would let a guest "pay for" an order the kitchen
   *     hasn't even started — which would be settled but uncooked.
   *   • Cancelled and comped items are silently ignored (cancelled =
   *     not owed; comped = explicitly free, no settlement needed).
   *   • If the selected itemIds cover ALL non-cancelled items in an
   *     Order, that Order is returned as-is (no split — it's already
   *     a clean unit of payment).
   *   • Tip stays on the parent Order and is reset to 0 on the split-
   *     off. Tip on the round is set later by stamp/confirm.
   *   • New Order keeps guestNumber/guestName/orderType/station/
   *     etc from the parent, gets a fresh orderNumber and a
   *     parentOrderId pointer for the cancel/reverse merge-back path.
   *
   * Wrapped in the per-session advisory lock so a fresh order POST
   * can't race the split.
   */
  async splitOrderForPayment(input: {
    sessionId: string;
    itemIds: string[];
  }): Promise<{
    payableOrderIds: string[];
    splitOrderIds: string[];
  }> {
    const { sessionId, itemIds } = input;
    if (!itemIds || itemIds.length === 0) {
      return { payableOrderIds: [], splitOrderIds: [] };
    }

    return db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${sessionId}, 1))`;

      // Pull the candidate items, scoped to this session's unpaid orders.
      // Anything not in this set (wrong session, already paid, cancelled,
      // comped, not yet served) is filtered out so a malformed request
      // can never escape its lane.
      const items = await tx.orderItem.findMany({
        where: {
          id: { in: itemIds },
          cancelled: false,
          comped: false,
          order: {
            sessionId,
            paidAt: null,
            // Match legacy confirmPayRound: any non-CANCELLED, non-PAID
            // order is payable. The earlier SERVED-only restriction was
            // too tight — it left a guest unable to pay for a drink
            // that's READY but not yet "served" by the waiter (a
            // common cafe case where the waiter hasn't tapped the
            // status button after handing it over). The cashier card
            // and the legacy "Pay X EGP" button both accept any
            // non-CANCELLED status; the picker should too.
            status: { notIn: ["CANCELLED", "PAID"] },
          },
        },
        select: {
          id: true,
          orderId: true,
          quantity: true,
          price: true,
          addOns: true,
          notes: true,
          menuItemId: true,
          wasUpsell: true,
        },
      });
      if (items.length === 0) {
        return { payableOrderIds: [], splitOrderIds: [] };
      }

      const byOrder = new Map<string, typeof items>();
      for (const it of items) {
        const arr = byOrder.get(it.orderId) ?? [];
        arr.push(it);
        byOrder.set(it.orderId, arr);
      }

      const payableOrderIds: string[] = [];
      const splitOrderIds: string[] = [];

      for (const [orderId, picked] of byOrder.entries()) {
        const parent = await tx.order.findUnique({
          where: { id: orderId },
          include: {
            items: {
              where: { cancelled: false },
              select: { id: true, price: true, quantity: true, comped: true },
            },
          },
        });
        if (!parent) continue;

        const liveItemIds = parent.items.map((i) => i.id);
        const pickedIds = new Set(picked.map((p) => p.id));
        const allPicked = liveItemIds.every((id) => pickedIds.has(id));
        if (allPicked) {
          // Whole order picked — no split needed; settle it directly.
          payableOrderIds.push(parent.id);
          continue;
        }

        // Per-restaurant orderNumber: take next from the highest used today.
        const lastForRestaurant = await tx.order.findFirst({
          where: { restaurantId: parent.restaurantId },
          orderBy: { orderNumber: "desc" },
          select: { orderNumber: true },
        });
        const nextOrderNumber = (lastForRestaurant?.orderNumber ?? 0) + 1;

        // Subtotal of the split-off = sum of item.price * qty for picked.
        // Tax stays at 0 in this app, deliveryFee stays on the parent
        // (it's a session-level fee, not item-level), tip resets to 0
        // (round-level, set on confirm). total = subtotal.
        const splitSubtotal = picked.reduce(
          (s, it) => s + Number(it.price) * it.quantity, 0,
        );

        const splitOrder = await tx.order.create({
          data: {
            orderNumber: nextOrderNumber,
            status: "SERVED",
            tableId: parent.tableId,
            restaurantId: parent.restaurantId,
            sessionId: parent.sessionId,
            subtotal: splitSubtotal,
            tax: 0,
            total: splitSubtotal,
            tip: 0,
            deliveryFee: 0,
            paymentMethod: null,
            paidAt: null,
            readyAt: parent.readyAt,
            servedAt: parent.servedAt,
            notes: null,
            guestNumber: parent.guestNumber,
            guestName: parent.guestName,
            language: parent.language,
            station: parent.station,
            // Intentionally NOT copying parent.groupId. groupId means
            // "kitchen + bar siblings from the same cart" — the
            // guest-poll merger folds those back into a single
            // displayed order. If a split-off shared the parent's
            // groupId it would re-merge with the parent and obscure
            // the partial payment on the guest's bill view. parent
            // ↔ split linkage lives on parentOrderId instead.
            groupId: null,
            orderType: parent.orderType,
            vipGuestId: parent.vipGuestId,
            parentOrderId: parent.id,
          },
        });

        // Move the picked items onto the split order.
        await tx.orderItem.updateMany({
          where: { id: { in: picked.map((p) => p.id) } },
          data: { orderId: splitOrder.id },
        });

        // Recompute parent totals from the items that remain.
        const remaining = parent.items.filter((i) => !pickedIds.has(i.id));
        const parentSubtotal = remaining.reduce(
          (s, i) => s + (i.comped ? 0 : Number(i.price) * i.quantity), 0,
        );
        await tx.order.update({
          where: { id: parent.id },
          data: {
            subtotal: parentSubtotal,
            // total = subtotal + tax + deliveryFee. Tax stays 0; the
            // delivery fee (if any) stays on the parent. Tip on the
            // parent is left untouched — a guest can have already pre-
            // stamped a tip and then chosen to split-pay only some
            // items, in which case the tip belongs to the remaining
            // round, not this one.
            total: parentSubtotal + Number(parent.tax) + Number(parent.deliveryFee),
          },
        });

        payableOrderIds.push(splitOrder.id);
        splitOrderIds.push(splitOrder.id);
      }

      return { payableOrderIds, splitOrderIds };
    });
  }

  /**
   * Cashier confirms a pay round atomically. Tip and discount are
   * stamped on the first order in the round (the round's "head"); the
   * rest carry tip=0/discount=0 so the receipt has a single source of
   * truth per round.
   *
   * Discount semantics:
   *   - Always passed in as a resolved EGP amount (the cashier UI
   *     converts a percentage to EGP before calling). Anything else
   *     keeps the math centralised in one place.
   *   - Capped at the round's gross subtotal so the cashier can't
   *     accidentally type "1000" on a 500 EGP bill and produce a
   *     negative collected amount.
   *   - `confirmedTotal` returned here is what the cashier actually
   *     collects — gross minus discount. Down-stream surfaces (cash
   *     drawer reconciliation, post-settle flash) read this number.
   */
  async confirmPayRound(input: {
    sessionId: string;
    paymentMethod: string;
    tipAmount: number;
    discountAmount?: number;
  }): Promise<
    | { noop: true; orders: never[]; confirmedTotal: 0; discount: 0; serviceCharge: 0 }
    | { noop: false; orders: Array<{ id: string; status: string; total: unknown }>; confirmedTotal: number; discount: number; serviceCharge: number; method: string }
  > {
    const { sessionId, paymentMethod, tipAmount, discountAmount } = input;
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
        return { noop: true, orders: [] as never[], confirmedTotal: 0, discount: 0, serviceCharge: 0 } as const;
      }

      // Service charge: in RUNNER mode at percent>0, auto-add a
      // mandatory % of the round's gross subtotal. Lives on Order.
      // serviceCharge alongside `tip` (which stays optional and zero
      // in RUNNER mode unless someone explicitly types it). Cashier
      // confirm modal previews this; receipt prints it as a line.
      const sessionRow = await tx.tableSession.findUnique({
        where: { id: sessionId },
        select: { restaurantId: true },
      });
      const restaurantCfg = sessionRow
        ? await tx.restaurant.findUnique({
            where: { id: sessionRow.restaurantId },
            select: { serviceModel: true, serviceChargePercent: true },
          })
        : null;
      const isRunnerMode = restaurantCfg?.serviceModel === "RUNNER";
      const chargePct = restaurantCfg?.serviceChargePercent
        ? Number(restaurantCfg.serviceChargePercent)
        : 0;

      const now = new Date();
      const method = (paymentMethod || "CASH") as "CASH" | "CARD" | "INSTAPAY" | "APPLE_PAY" | "GOOGLE_PAY";
      const tipTargetId = orders[0]?.id;

      // Auto-stop any still-running activity timers on the orders being
      // settled. The bill prorates against (now - startedAt) regardless,
      // but writing activityStoppedAt makes the receipt show a static
      // duration ("(1h 32m)" instead of "(1h 32m) · running") and lets
      // the recomputed total below stay stable across re-fetches.
      const orderIds = orders.map((o) => o.id);
      const runningActivityItems = await tx.orderItem.findMany({
        where: {
          orderId: { in: orderIds },
          activityStartedAt: { not: null },
          activityStoppedAt: null,
        },
        select: {
          id: true,
          orderId: true,
          quantity: true,
          activityStartedAt: true,
          menuItem: { select: { pricePerHour: true } },
        },
      });
      if (runningActivityItems.length > 0) {
        for (const it of runningActivityItems) {
          await tx.orderItem.update({
            where: { id: it.id },
            data: { activityStoppedAt: now },
          });
        }
        // Recompute order totals for any order whose items changed.
        const affectedOrderIds = new Set(runningActivityItems.map((it) => it.orderId));
        for (const oid of affectedOrderIds) {
          const allItems = await tx.orderItem.findMany({
            where: { orderId: oid, cancelled: false },
            select: {
              quantity: true,
              price: true,
              comped: true,
              activityStartedAt: true,
              activityStoppedAt: true,
              menuItem: { select: { pricePerHour: true } },
            },
          });
          const newSubtotal = allItems.reduce((sum, it) => {
            if (it.comped) return sum;
            const pph = it.menuItem?.pricePerHour ? Number(it.menuItem.pricePerHour) : 0;
            if (pph > 0 && it.activityStartedAt) {
              const end = it.activityStoppedAt ?? now;
              const minutes = Math.max(1, Math.ceil((end.getTime() - it.activityStartedAt.getTime()) / 60000));
              return sum + Math.ceil((minutes / 60) * pph) * it.quantity;
            }
            return sum + Number(it.price) * it.quantity;
          }, 0);
          const ord = await tx.order.findUnique({
            where: { id: oid },
            select: { tax: true, deliveryFee: true },
          });
          const tax = Number(ord?.tax ?? 0);
          const fee = Number(ord?.deliveryFee ?? 0);
          await tx.order.update({
            where: { id: oid },
            data: { subtotal: newSubtotal, total: newSubtotal + tax + fee },
          });
        }
        // Re-read the updated totals so the round subtotal below uses
        // the finalized prorated numbers, not the stale at-creation
        // values.
        orders = await tx.order.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, status: true, total: true },
        });
      }

      // Round subtotal first — needed to cap the discount + compute
      // the service charge.
      const grossTotal = orders.reduce((sum, o) => sum + Number(o.total ?? 0), 0);
      const cleanDiscount = typeof discountAmount === "number" && discountAmount > 0 && isFinite(discountAmount)
        ? Math.min(Math.round(discountAmount), Math.round(grossTotal))
        : 0;
      // Service charge resolves from the discounted subtotal, not the
      // gross — guest pays % on what they're actually being charged.
      const serviceCharge = isRunnerMode && chargePct > 0
        ? Math.round((grossTotal - cleanDiscount) * (chargePct / 100))
        : 0;

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
              ...(isTipTarget ? { discount: cleanDiscount } : { discount: 0 }),
              ...(isTipTarget ? { serviceCharge } : { serviceCharge: 0 }),
            },
          });
        } else {
          await tx.order.update({
            where: { id: order.id },
            data: {
              paymentMethod: method,
              paidAt: now,
              ...(isTipTarget ? { tip: Math.max(0, Math.round(tipAmount)) } : { tip: 0 }),
              ...(isTipTarget ? { discount: cleanDiscount } : { discount: 0 }),
              ...(isTipTarget ? { serviceCharge } : { serviceCharge: 0 }),
            },
          });
        }
      }

      // confirmedTotal is what the cashier physically collects:
      // gross − discount + service charge. (Tip stays separate; it's
      // collected in the same transaction but accounted on a
      // different line on the receipt.)
      const confirmedTotal = grossTotal - cleanDiscount + serviceCharge;
      return { noop: false, orders, confirmedTotal, discount: cleanDiscount, serviceCharge, method } as const;
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
        select: { id: true, status: true, total: true, paymentMethod: true, parentOrderId: true },
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

      // For reversed split-off Orders, merge the items back into the
      // parent. Without this, undoing a partial-pay would leave the
      // bill split into Order rows nobody asked to keep separate, and
      // the next "pay all" tap would charge them as two distinct
      // rounds on the receipt.
      const splitsToMerge = affected.filter((o) => o.parentOrderId);
      for (const split of splitsToMerge) {
        await mergeSplitBackIntoParent(tx, split.id, split.parentOrderId!);
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

      // Returning APPROVED guest → walk back in. Owner if their record
      // is the earliest APPROVED for the session, member otherwise.
      if (existing && existing.status === "APPROVED") {
        const isOwner = earliestApproved?.id === existing.id;
        return { id: existing.id, status: "approved", role: isOwner ? "owner" : "member" };
      }

      // No client has been registered as owner yet. Guard against the
      // legacy case where a guest-created session predates owner-
      // stamping (no APPROVED record but a real client guest is already
      // actively using the table) by checking menuOpenedAt. That field
      // is only set when a guest browser hits the menu page
      // (ImmersiveMenu → POST /api/sessions menu_opened) — staff flows
      // (waiter Seat, dashboard assign, floor manager) never trigger
      // it. So menuOpenedAt === null is a reliable "no client guest
      // has joined yet" signal that survives the case where staff
      // pre-placed orders before the first guest scanned.
      if (!earliestApproved) {
        const session = await tx.tableSession.findUnique({
          where: { id: sessionId },
          select: { menuOpenedAt: true },
        });
        if (session && session.menuOpenedAt === null) {
          // If this guest has a stranded PENDING from a pre-fix attempt,
          // upgrade it in place rather than leaving them stuck on "Ask
          // Guest #1" forever — there is no Guest #1 to approve them,
          // and a pure POST loop with the same guestId would just keep
          // echoing back that same PENDING. Without this upgrade the
          // bug self-perpetuates after deploy.
          if (existing) {
            const upgraded = await tx.joinRequest.update({
              where: { id: existing.id },
              data: { status: "APPROVED" },
            });
            return { id: upgraded.id, status: "approved", role: "owner" };
          }
          const claim = await tx.joinRequest.create({
            data: { sessionId, guestId, status: "APPROVED" },
          });
          return { id: claim.id, status: "approved", role: "owner" };
        }
      }

      // Owner exists and this guest already has a PENDING — keep them
      // in the waiting room rather than stacking duplicate requests.
      if (existing) {
        return { id: existing.id, status: "pending", role: "member" };
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

  /**
   * List every pending join request across the whole restaurant. Used
   * by the floor manager's "stuck at gate" panel — shows each guest
   * who tapped to join while the session owner is somewhere not
   * looking at their phone (pool, bathroom, etc), so the floor
   * manager can admit them directly.
   *
   * Joins on the session + table so the panel can show "Table 7, 8m
   * waiting" without an extra round-trip per row. Filters out CLOSED
   * sessions defensively (session.delete cascades JoinRequest rows so
   * this should only matter mid-close-race, but it costs nothing).
   */
  async listPendingJoinRequestsForRestaurant(restaurantId: string) {
    return db.joinRequest.findMany({
      where: {
        status: "PENDING",
        session: { restaurantId, status: "OPEN" },
      },
      include: {
        session: {
          select: {
            id: true,
            tableId: true,
            guestCount: true,
            table: { select: { number: true } },
            vipGuest: { select: { name: true } },
            orderType: true,
          },
        },
      },
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
