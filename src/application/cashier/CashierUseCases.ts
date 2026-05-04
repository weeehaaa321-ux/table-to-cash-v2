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

  async findOpenDrawerForCashier(restaurantId: string, cashierId: string) {
    return db.cashDrawer.findFirst({
      where: { restaurantId, cashierId, closedAt: null },
      orderBy: { openedAt: "desc" },
    });
  }

  async findDrawerById(id: string) {
    return db.cashDrawer.findUnique({ where: { id } });
  }

  async sumCashSince(restaurantId: string, since: Date): Promise<number> {
    // Expected cash = total + tip + serviceCharge − discount, summed
    // over CASH-paid orders. Each term is a separate column on Order:
    //   total          — gross subtotal (what the items cost)
    //   tip            — optional gratuity (WAITER mode)
    //   serviceCharge  — mandatory % (RUNNER mode); pooled, distributed
    //                    by management policy. The cashier still
    //                    physically holds it at end of shift.
    //   discount       — cashier-applied EGP off
    // Without each term the drawer would show phantom variance:
    // tip-night was positive, discount-night negative, service-charge-
    // night positive. Each one folded in keeps reconciliation honest
    // regardless of which mode the restaurant runs in.
    const agg = await db.order.aggregate({
      where: {
        restaurantId,
        paymentMethod: "CASH",
        paidAt: { gte: since },
        status: { not: "CANCELLED" },
      },
      _sum: { total: true, tip: true, discount: true, serviceCharge: true },
    });
    const total = agg._sum.total == null ? 0 : Number(agg._sum.total);
    const tip = agg._sum.tip == null ? 0 : Number(agg._sum.tip);
    const discount = agg._sum.discount == null ? 0 : Number(agg._sum.discount);
    const sc = agg._sum.serviceCharge == null ? 0 : Number(agg._sum.serviceCharge);
    return total + tip + sc - discount;
  }

  async createOpenDrawer(input: { restaurantId: string; cashierId: string; openingFloat: number }) {
    return db.cashDrawer.create({
      data: {
        restaurantId: input.restaurantId,
        cashierId: input.cashierId,
        openingFloat: input.openingFloat,
      },
    });
  }

  async finalizeDrawer(input: {
    drawerId: string;
    closingCount: number;
    expectedCash: number;
    variance: number;
    notes: string | null;
  }) {
    return db.cashDrawer.update({
      where: { id: input.drawerId },
      data: {
        closedAt: new Date(),
        closingCount: input.closingCount,
        expectedCash: input.expectedCash,
        variance: input.variance,
        notes: input.notes,
      },
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

  async listTodaysSettlements(input: {
    restaurantId: string;
    waiterId?: string | null;
    cashierId?: string | null;
    status?: string | null;
  }) {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const where: Record<string, unknown> = {
      restaurantId: input.restaurantId,
      requestedAt: { gte: todayStart },
    };
    if (input.waiterId) where.waiterId = input.waiterId;
    if (input.cashierId) where.cashierId = input.cashierId;
    if (input.status) where.status = input.status;
    return db.cashSettlement.findMany({
      where,
      include: {
        waiter: { select: { id: true, name: true } },
        cashier: { select: { id: true, name: true } },
      },
      orderBy: { requestedAt: "desc" },
    });
  }

  async findStaffScope(staffId: string) {
    return db.staff.findUnique({
      where: { id: staffId },
      select: { restaurantId: true, role: true },
    });
  }

  async findStaffName(staffId: string) {
    return db.staff.findUnique({ where: { id: staffId }, select: { name: true } });
  }

  async createSettlementWithRelations(input: {
    amount: number;
    waiterId: string;
    cashierId: string;
    cashierName: string;
    restaurantId: string;
  }) {
    return db.cashSettlement.create({
      data: input,
      include: {
        waiter: { select: { id: true, name: true } },
        cashier: { select: { id: true, name: true } },
      },
    });
  }

  async findSettlementScope(settlementId: string) {
    return db.cashSettlement.findUnique({
      where: { id: settlementId },
      select: { restaurantId: true, waiterId: true, cashierId: true, status: true },
    });
  }

  async acceptSettlement(settlementId: string) {
    return db.cashSettlement.update({
      where: { id: settlementId },
      data: { status: "ACCEPTED", acceptedAt: new Date() },
      include: { waiter: { select: { name: true } }, cashier: { select: { id: true, name: true } } },
    });
  }

  async confirmSettlement(settlementId: string) {
    return db.cashSettlement.update({
      where: { id: settlementId },
      data: { status: "CONFIRMED", confirmedAt: new Date() },
      include: { waiter: { select: { id: true, name: true } } },
    });
  }

  async rejectSettlement(settlementId: string) {
    return db.cashSettlement.update({
      where: { id: settlementId },
      data: { status: "REJECTED" },
    });
  }

  async logSettlementMessage(input: {
    cashierId: string;
    waiterId: string;
    text: string;
    settlementId: string;
    restaurantId: string;
  }) {
    return db.message.create({
      data: {
        type: "command",
        from: input.cashierId,
        to: input.waiterId,
        text: input.text,
        command: `settle_cash:${input.settlementId}`,
        restaurantId: input.restaurantId,
      },
    });
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
  async resolveRestaurantId(id: string): Promise<string | null> {
    if (!id) return null;
    if (id.startsWith("c") && id.length > 10) return id;
    const r = await db.restaurant.findUnique({ where: { slug: id }, select: { id: true } });
    return r?.id || null;
  }

  async listRecentDailyCloses(restaurantId: string, take = 30) {
    return db.dailyClose.findMany({
      where: { restaurantId },
      orderBy: { date: "desc" },
      take,
    });
  }

  async findDailyClose(restaurantId: string, date: Date) {
    return db.dailyClose.findUnique({
      where: { restaurantId_date: { restaurantId, date } },
    });
  }

  async listOrdersForCloseWindow(restaurantId: string, dayStart: Date, dayEnd: Date) {
    return db.order.findMany({
      where: {
        restaurantId,
        paidAt: { gte: dayStart, lte: dayEnd },
        status: { not: "CANCELLED" },
      },
      include: {
        session: { select: { waiterId: true } },
        items: {
          select: {
            quantity: true,
            price: true,
            cancelled: true,
            comped: true,
            menuItem: { select: { name: true } },
          },
        },
      },
    });
  }

  async countSessionsInWindow(restaurantId: string, dayStart: Date, dayEnd: Date) {
    return db.tableSession.count({
      where: { restaurantId, openedAt: { gte: dayStart, lte: dayEnd } },
    });
  }

  async listStaffNamesByIds(ids: string[]) {
    return db.staff.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  }

  async createDailyClose(input: {
    restaurantId: string;
    date: Date;
    closedById: string;
    closedByName: string;
    totals: unknown;
    notes: string | null;
  }) {
    return db.dailyClose.create({ data: input as never });
  }

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

  /** Print invoice — only settled (paidAt) orders, with bilingual names. */
  async fetchSettledInvoice(sessionId: string) {
    return db.tableSession.findUnique({
      where: { id: sessionId },
      include: {
        table: { select: { number: true } },
        waiter: { select: { name: true } },
        restaurant: { select: { name: true, slug: true, currency: true } },
        orders: {
          where: { paidAt: { not: null }, status: { not: "CANCELLED" } },
          include: {
            // Pull pricePerHour + the timer pair so the invoice route
            // can render activity items as "Kayak (1h 32m) @ 500/hr"
            // instead of a flat-priced line that doesn't match what the
            // guest actually used.
            items: { include: { menuItem: { select: { name: true, nameAr: true, pricePerHour: true } } } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
  }
}
