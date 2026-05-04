// Daily-close compute logic. Used by both the manual owner endpoint and
// the nightly cron, so the books look identical whether closed by hand
// or by schedule. Kept side-effect-free — caller decides whether to
// persist the result.

import { db } from "@/lib/db";
import { nowInRestaurantTz } from "@/lib/restaurant-config";
import { toNum } from "@/lib/money";

export type DailyCloseTotals = {
  revenue: number;
  orders: number;
  sessions: number;
  cash: number;
  card: number;
  instapay: number;
  otherPay: number;
  compedValue: number;
  compedCount: number;
  cancelledValue: number;
  cancelledCount: number;
  byWaiter: {
    waiterId: string;
    name: string;
    revenue: number;
    orders: number;
    cash: number;
    card: number;
  }[];
};

// Convert a Cairo-local Date to a midnight @db.Date value.
export function cairoDateOnly(d: Date): Date {
  const c = nowInRestaurantTz(d);
  return new Date(Date.UTC(c.getFullYear(), c.getMonth(), c.getDate()));
}

// Default close target: today (Cairo), but if it's the small hours
// (00:00–05:59) the operator means yesterday — the shift that just
// ended. The cron runs at 5am, so this pushes it back one day.
export function defaultCloseTarget(now: Date = new Date()): Date {
  const cairoNow = nowInRestaurantTz(now);
  const target = cairoDateOnly(now);
  if (cairoNow.getHours() < 6) {
    return new Date(target.getTime() - 24 * 60 * 60 * 1000);
  }
  return target;
}

export async function computeDailyTotals(
  restaurantId: string,
  target: Date,
): Promise<DailyCloseTotals> {
  // We stored target as UTC-midnight-of-Cairo-date. To get the actual
  // wall window we offset by Cairo's UTC offset at that moment. Easier:
  // pull a 30h window centered on target+12h then filter to the actual
  // Cairo calendar day — cheap and correct across DST.
  const dayStart = new Date(target.getTime() - 3 * 60 * 60 * 1000);
  const dayEnd = new Date(target.getTime() + 27 * 60 * 60 * 1000);

  const orders = await db.order.findMany({
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

  const targetISO = target.toISOString().slice(0, 10);
  const inDay = orders.filter((o) => {
    if (!o.paidAt) return false;
    const cairo = nowInRestaurantTz(o.paidAt);
    const iso = new Date(
      Date.UTC(cairo.getFullYear(), cairo.getMonth(), cairo.getDate()),
    )
      .toISOString()
      .slice(0, 10);
    return iso === targetISO;
  });

  let revenue = 0,
    cash = 0,
    card = 0,
    instapay = 0,
    otherPay = 0;
  let compedValue = 0,
    cancelledValue = 0,
    compedCount = 0,
    cancelledCount = 0;
  const byWaiter = new Map<
    string,
    { revenue: number; orders: number; cash: number; card: number }
  >();

  for (const o of inDay) {
    // Net of cashier-applied discount: revenue and per-method totals
    // should reflect what was actually collected, not the gross
    // before-discount figure. Stored discount column is 0 for older
    // rows so historical days reconcile unchanged.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const oDiscount = toNum((o as any).discount ?? 0);
    const oTotal = toNum(o.total) - oDiscount;
    revenue += oTotal;
    const m = (o.paymentMethod || "OTHER").toUpperCase();
    if (m === "CASH") cash += oTotal;
    else if (m === "CARD") card += oTotal;
    else if (m === "INSTAPAY") instapay += oTotal;
    else otherPay += oTotal;

    const wid = o.session?.waiterId || "unassigned";
    const w = byWaiter.get(wid) || { revenue: 0, orders: 0, cash: 0, card: 0 };
    w.revenue += oTotal;
    w.orders += 1;
    if (m === "CASH") w.cash += oTotal;
    if (m === "CARD") w.card += oTotal;
    byWaiter.set(wid, w);

    for (const it of o.items) {
      const itPrice = toNum(it.price);
      if (it.cancelled) {
        cancelledValue += itPrice * it.quantity;
        cancelledCount += 1;
      }
      if (it.comped) {
        compedValue += itPrice * it.quantity;
        compedCount += 1;
      }
    }
  }

  const sessionsCount = await db.tableSession.count({
    where: {
      restaurantId,
      openedAt: { gte: dayStart, lte: dayEnd },
    },
  });

  const waiterIds = Array.from(byWaiter.keys()).filter(
    (id) => id !== "unassigned",
  );
  const waiters = await db.staff.findMany({
    where: { id: { in: waiterIds } },
    select: { id: true, name: true },
  });
  const nameById = new Map(waiters.map((w) => [w.id, w.name]));

  return {
    revenue: Math.round(revenue),
    orders: inDay.length,
    sessions: sessionsCount,
    cash: Math.round(cash),
    card: Math.round(card),
    instapay: Math.round(instapay),
    otherPay: Math.round(otherPay),
    compedValue: Math.round(compedValue),
    compedCount,
    cancelledValue: Math.round(cancelledValue),
    cancelledCount,
    byWaiter: Array.from(byWaiter.entries()).map(([id, agg]) => ({
      waiterId: id,
      name: id === "unassigned" ? "Unassigned" : nameById.get(id) || "—",
      revenue: Math.round(agg.revenue),
      orders: agg.orders,
      cash: Math.round(agg.cash),
      card: Math.round(agg.card),
    })),
  };
}

export type PersistedClose = {
  id: string;
  date: string;
  totals: DailyCloseTotals;
};

export async function persistClose(opts: {
  restaurantId: string;
  target: Date;
  closedById: string | null;
  closedByName: string;
  notes?: string | null;
}): Promise<{ kind: "ok"; close: PersistedClose } | { kind: "exists" }> {
  const existing = await db.dailyClose.findUnique({
    where: {
      restaurantId_date: {
        restaurantId: opts.restaurantId,
        date: opts.target,
      },
    },
  });
  if (existing) return { kind: "exists" };

  const totals = await computeDailyTotals(opts.restaurantId, opts.target);

  const close = await db.dailyClose.create({
    data: {
      restaurantId: opts.restaurantId,
      date: opts.target,
      closedById: opts.closedById,
      closedByName: opts.closedByName,
      totals,
      notes: opts.notes || null,
    },
  });

  return {
    kind: "ok",
    close: {
      id: close.id,
      date: close.date.toISOString().slice(0, 10),
      totals,
    },
  };
}
