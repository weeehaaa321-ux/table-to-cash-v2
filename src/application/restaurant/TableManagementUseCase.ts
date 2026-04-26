import type { PrismaRestaurantRepository } from "@/infrastructure/prisma/repositories/PrismaRestaurantRepository";
import { db } from "@/infrastructure/prisma/client";
import type { Table } from "@/domain/restaurant/Table";

/**
 * Table CRUD operations. The DELETE flow cascades through related rows
 * (sessions, orders, ratings, joinRequests) — that complexity stays
 * inside the use case rather than leaking to the route.
 */
export class TableManagementUseCase {
  constructor(private readonly repo: PrismaRestaurantRepository) {}

  async list(): Promise<readonly Table[]> {
    return this.repo.listTables();
  }

  async addNext(label: string | null): Promise<{ id: string; number: number; label: string }> {
    const restaurant = await this.repo.current();
    const max = await db.table.findFirst({
      where: { restaurantId: restaurant.id },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    const nextNumber = (max?.number || 0) + 1;
    const t = await db.table.create({
      data: {
        number: nextNumber,
        label: label || `Table ${nextNumber}`,
        restaurantId: restaurant.id,
      },
    });
    return { id: t.id, number: t.number, label: t.label ?? `Table ${t.number}` };
  }

  /**
   * Delete a table by number, only if no active session. Cascade-deletes
   * all related rows (orders, items, ratings, joinRequests, sessions).
   */
  async deleteByNumber(
    number: number,
  ): Promise<{ ok: true } | { ok: false; reason: "not_found" | "has_active_session" }> {
    const restaurant = await this.repo.current();
    const table = await db.table.findUnique({
      where: { restaurantId_number: { restaurantId: restaurant.id, number } },
      include: { sessions: { where: { status: "OPEN" }, select: { id: true } } },
    });
    if (!table) return { ok: false, reason: "not_found" };
    if (table.sessions.length > 0) return { ok: false, reason: "has_active_session" };

    const sessionIds = (
      await db.tableSession.findMany({ where: { tableId: table.id }, select: { id: true } })
    ).map((s) => s.id);
    if (sessionIds.length > 0) {
      await db.joinRequest.deleteMany({ where: { sessionId: { in: sessionIds } } }).catch(() => {});
      await db.rating.deleteMany({ where: { sessionId: { in: sessionIds } } }).catch(() => {});
    }
    const orderIds = (
      await db.order.findMany({ where: { tableId: table.id }, select: { id: true } })
    ).map((o) => o.id);
    if (orderIds.length > 0) {
      await db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    }
    await db.order.deleteMany({ where: { tableId: table.id } });
    await db.tableSession.deleteMany({ where: { tableId: table.id } });
    await db.table.delete({ where: { id: table.id } });
    return { ok: true };
  }
}
