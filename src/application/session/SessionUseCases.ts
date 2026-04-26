// Session lifecycle — wraps legacy queries + db calls.
// Includes the multi-round payment, reverse, delegate, and join flows.

import { db } from "@/lib/db";
import { maybeCloseSession } from "@/lib/queries";
import { getCurrentShift } from "@/lib/shifts";
import { computeSessionRounds } from "@/lib/session-rounds";
import { nowInRestaurantTz } from "@/lib/restaurant-config";

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

  /** Lookup an open session for a table number. Used by /api/sessions GET ?tableNumber=. */
  async findOpenForTable(tableNumber: number, restaurantId: string) {
    const table = await db.table.findUnique({
      where: { restaurantId_number: { restaurantId, number: tableNumber } },
    });
    if (!table) return null;
    return db.tableSession.findFirst({
      where: { tableId: table.id, restaurantId, status: "OPEN" },
      include: {
        orders: {
          include: { items: { include: { menuItem: { select: { name: true, image: true } } } } },
        },
      },
    });
  }

  async findById(sessionId: string) {
    return db.tableSession.findUnique({
      where: { id: sessionId },
      include: {
        table: { select: { number: true } },
        orders: {
          include: { items: { include: { menuItem: { select: { name: true, image: true } } } } },
        },
      },
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async create(data: any) {
    return db.tableSession.create({ data });
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

  /** Pay a round — marks the recent unpaid orders as paid. Wraps the
      multi-bucket-aware logic from /api/sessions/pay/route.ts. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async payRound(input: { sessionId: string; paymentMethod: string; tip?: number; orderIds?: string[] }): Promise<any> {
    // Defer to the legacy implementation — the route still imports
    // db directly for this; the use case is the seam.
    const where = input.orderIds && input.orderIds.length > 0
      ? { id: { in: input.orderIds } }
      : { sessionId: input.sessionId, paidAt: null };
    return db.order.updateMany({
      where,
      data: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        paymentMethod: input.paymentMethod as any,
        paidAt: new Date(),
      },
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

  /** Helpers that legacy lib functions used to expose directly. */
  currentShift(): 1 | 2 | 3 {
    return getCurrentShift();
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  computeRounds(orders: any[]): any {
    return computeSessionRounds(orders);
  }
  nowInTz(): Date {
    return nowInRestaurantTz();
  }
}
