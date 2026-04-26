// Cashier flows — drawer, settlements, daily close, invoice.
// Thin wrappers around legacy lib/db calls.

import { db } from "@/lib/db";

export class CashierUseCases {
  // ─── Drawer ──────────────────────────────────
  async openDrawer(cashierId: string, restaurantId: string, openingFloat: number) {
    return db.cashDrawer.create({
      data: {
        cashierId,
        restaurantId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        openingFloat: openingFloat as any,
      },
    });
  }

  async closeDrawer(id: string, closingCount: number, expectedCash: number, notes?: string) {
    const variance = closingCount - expectedCash;
    return db.cashDrawer.update({
      where: { id },
      data: {
        closedAt: new Date(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        closingCount: closingCount as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expectedCash: expectedCash as any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        variance: variance as any,
        notes: notes ?? null,
      },
    });
  }

  async listOpenDrawers(restaurantId: string) {
    return db.cashDrawer.findMany({
      where: { restaurantId, closedAt: null },
      orderBy: { openedAt: "desc" },
    });
  }

  async listDrawers(restaurantId: string, days = 14) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    return db.cashDrawer.findMany({
      where: { restaurantId, openedAt: { gte: since } },
      orderBy: { openedAt: "desc" },
    });
  }

  // ─── Settlements ──────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async createSettlement(data: any) {
    return db.cashSettlement.create({ data });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async updateSettlement(id: string, data: any) {
    return db.cashSettlement.update({ where: { id }, data });
  }

  async listSettlements(restaurantId: string, status?: string) {
    return db.cashSettlement.findMany({
      where: {
        restaurantId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(status ? { status: status as any } : {}),
      },
      orderBy: { requestedAt: "desc" },
      take: 100,
    });
  }

  // ─── Daily close ──────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async upsertDailyClose(data: any) {
    return db.dailyClose.upsert({
      where: {
        restaurantId_date: { restaurantId: data.restaurantId, date: data.date },
      },
      create: data,
      update: { closedAt: new Date(), totals: data.totals, notes: data.notes },
    });
  }

  async getDailyClose(restaurantId: string, date: Date) {
    return db.dailyClose.findUnique({
      where: { restaurantId_date: { restaurantId, date } },
    });
  }

  async listDailyCloses(restaurantId: string, days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    return db.dailyClose.findMany({
      where: { restaurantId, date: { gte: since } },
      orderBy: { date: "desc" },
    });
  }

  // ─── Invoice ──────────────────────────────────
  async fetchInvoice(sessionId: string) {
    return db.tableSession.findUnique({
      where: { id: sessionId },
      include: {
        table: { select: { number: true } },
        vipGuest: { select: { name: true } },
        waiter: { select: { name: true } },
        restaurant: { select: { name: true, currency: true } },
        orders: {
          include: { items: { include: { menuItem: { select: { name: true } } } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
  }
}
