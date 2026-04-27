import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";
import { nowInRestaurantTz } from "@/lib/restaurant-config";
import { requireOwnerAuth, requireStaffAuth } from "@/lib/api-auth";
import { toNum } from "@/lib/money";

// Convert a Cairo-local Date to a midnight @db.Date value.
function cairoDateOnly(d: Date): Date {
  const c = nowInRestaurantTz(d);
  return new Date(Date.UTC(c.getFullYear(), c.getMonth(), c.getDate()));
}

// GET: List recent daily closes (latest 30) for this restaurant.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const restaurantId = url.searchParams.get("restaurantId") || "";
  if (!restaurantId) {
    return NextResponse.json({ closes: [] });
  }

  // Daily closes are book-of-record numbers — anyone with access to
  // them can read total revenue, comped value, per-waiter breakdown.
  // Lock to staff who'd legitimately review numbers; floor + cashier
  // need the day-end recap, not just owners.
  const authed = await requireStaffAuth(request, ["OWNER", "FLOOR_MANAGER", "CASHIER"]);
  if (authed instanceof NextResponse) return authed;
  const realId = await useCases.cashier.resolveRestaurantId(restaurantId);
  if (!realId) return NextResponse.json({ closes: [] });
  if (realId !== authed.restaurantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const closes = await useCases.cashier.listRecentDailyCloses(realId, 30);
    return NextResponse.json({
      closes: closes.map((c) => ({
        id: c.id,
        date: c.date.toISOString().slice(0, 10),
        closedAt: c.closedAt.toISOString(),
        closedByName: c.closedByName,
        totals: c.totals,
        notes: c.notes,
      })),
    });
  } catch (err) {
    console.error("Daily close list failed:", err);
    return NextResponse.json({ closes: [] });
  }
}

// POST: Snapshot today's totals and lock the day.
// Body: { restaurantId, date?, notes? }
// `date` defaults to today (Cairo). Refuses to overwrite an existing close
// — if the owner needs to amend, they delete first (no UI for that on
// purpose; deletions go through DB).
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { restaurantId, date, notes } = body as {
    restaurantId?: string;
    date?: string;
    notes?: string;
  };

  if (!restaurantId) {
    return NextResponse.json(
      { error: "restaurantId required" },
      { status: 400 },
    );
  }

  // Owner-only — closing locks the day's numbers for tax/accounting.
  // The caller's identity comes from the authenticated header, never
  // the body, so a phished cuid in someone's request log can't lock
  // the day on the owner's behalf.
  const authed = await requireOwnerAuth(request);
  if (authed instanceof NextResponse) return authed;
  if (authed.role !== "OWNER") {
    return NextResponse.json({ error: "Owner only" }, { status: 403 });
  }

  const realId = await useCases.cashier.resolveRestaurantId(restaurantId);
  if (!realId) return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
  if (realId !== authed.restaurantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const staff = await useCases.staffManagement.findActorIdentity(authed.id);
  if (!staff) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Determine the business day to close. If the caller gave an explicit
  // date, use it. Otherwise default to "today (Cairo)" — but if we're in
  // the small hours (00:00–05:59 Cairo) assume the owner means the shift
  // that *just* ended and roll back to yesterday. Without this, a 1am
  // close snapshots an empty new day and the real day never gets closed.
  let target: Date;
  if (date) {
    target = new Date(date + "T00:00:00Z");
  } else {
    const cairoNow = nowInRestaurantTz(new Date());
    target = cairoDateOnly(new Date());
    if (cairoNow.getHours() < 6) {
      target = new Date(target.getTime() - 24 * 60 * 60 * 1000);
    }
  }

  const existing = await useCases.cashier.findDailyClose(realId, target);
  if (existing) {
    return NextResponse.json(
      { error: "ALREADY_CLOSED", message: "This day is already closed" },
      { status: 409 },
    );
  }

  // Day window: [target 00:00 Cairo, +24h)
  // We stored target as UTC-midnight-of-Cairo-date. To get the actual
  // wall window we offset by Cairo's UTC offset at that moment. Easier:
  // compare against any order whose paidAt falls within the same
  // Cairo calendar day. We approximate with a 30h window centered on
  // target+12h then filter — cheap and correct.
  const dayStart = new Date(target.getTime() - 3 * 60 * 60 * 1000); // safety pad
  const dayEnd = new Date(target.getTime() + 27 * 60 * 60 * 1000);

  try {
    const orders = await useCases.cashier.listOrdersForCloseWindow(realId, dayStart, dayEnd);

    // Tighten to actual Cairo day.
    const targetISO = target.toISOString().slice(0, 10);
    const inDay = orders.filter((o) => {
      if (!o.paidAt) return false;
      const cairo = nowInRestaurantTz(o.paidAt);
      const iso = new Date(Date.UTC(cairo.getFullYear(), cairo.getMonth(), cairo.getDate()))
        .toISOString().slice(0, 10);
      return iso === targetISO;
    });

    let revenue = 0, cash = 0, card = 0, instapay = 0, otherPay = 0;
    let compedValue = 0, cancelledValue = 0, compedCount = 0, cancelledCount = 0;
    const byWaiter = new Map<string, { revenue: number; orders: number; cash: number; card: number }>();

    for (const o of inDay) {
      const oTotal = toNum(o.total);
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

    const sessionsCount = await useCases.cashier.countSessionsInWindow(realId, dayStart, dayEnd);

    const waiterIds = Array.from(byWaiter.keys()).filter((id) => id !== "unassigned");
    const waiters = await useCases.cashier.listStaffNamesByIds(waiterIds);
    const nameById = new Map(waiters.map((w) => [w.id, w.name]));

    const totals = {
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
        name: id === "unassigned" ? "Unassigned" : (nameById.get(id) || "—"),
        revenue: Math.round(agg.revenue),
        orders: agg.orders,
        cash: Math.round(agg.cash),
        card: Math.round(agg.card),
      })),
    };

    const close = await useCases.cashier.createDailyClose({
      restaurantId: realId,
      date: target,
      closedById: authed.id,
      closedByName: staff.name,
      totals,
      notes: notes || null,
    });

    return NextResponse.json({
      success: true,
      id: close.id,
      date: close.date.toISOString().slice(0, 10),
      totals,
    });
  } catch (err) {
    console.error("Daily close failed:", err);
    return NextResponse.json({ error: "Close failed" }, { status: 500 });
  }
}
