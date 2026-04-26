import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { db } from "@/lib/db";
import { getOrdersForRestaurant, getDefaultRestaurant, getRestaurantBySlug } from "@/lib/queries";
import { getCurrentShift } from "@/lib/shifts";
import { computeSessionRounds } from "@/lib/session-rounds";
import { nowInRestaurantTz } from "@/lib/restaurant-config";
import { toNum } from "@/lib/money";

// ═══════════════════════════════════════════════════════
// LIVE SNAPSHOT — combined endpoint
//
// Returns orders + sessions + tables in a single response so the
// client does ONE round-trip per poll instead of three. Behavior is
// identical to calling /api/orders, /api/sessions/all, /api/tables
// individually — same queries, same side effects (including the
// midnight/shift-change auto-reassignment of sessions/all).
// ═══════════════════════════════════════════════════════

async function resolveRestaurantId(id: string): Promise<string | null> {
  if (!id) return null;
  if (id.startsWith("c") && id.length > 10) return id;
  const restaurant = await getRestaurantBySlug(id);
  return restaurant?.id || null;
}

function getShiftStart(shift: number): Date {
  const now = new Date();
  const cairoNow = nowInRestaurantTz(now);
  const offset = now.getTime() - cairoNow.getTime();
  const today = new Date(cairoNow.getFullYear(), cairoNow.getMonth(), cairoNow.getDate());
  const shiftStartHour = (shift - 1) * 8;
  return new Date(today.getTime() + shiftStartHour * 3600000 + offset);
}

// Guard: only run reassignment once per shift per restaurant (not on
// every poll). Two pieces of state per restaurant:
//   - lastReassignShift: which shift number we last successfully ran for.
//   - reassignBackoffUntil: when a failure happened, refuse to retry
//     until this timestamp. Without this, one persistently bad row
//     would kick the loop on every 30s tick and re-issue dozens of
//     UPDATEs each time, which is exactly the cost-blowup we're
//     defending against.
const lastReassignShift = new Map<string, number>();
const reassignBackoffUntil = new Map<string, number>();
const REASSIGN_BACKOFF_MS = 5 * 60 * 1000; // 5 min after a failure

async function maybeReassignSessions(realId: string, currentShift: number) {
  const lastShift = lastReassignShift.get(realId);
  if (lastShift === currentShift) return; // Already reassigned this shift

  const backoff = reassignBackoffUntil.get(realId) || 0;
  if (Date.now() < backoff) return;

  // Set the guard *before* doing any work so parallel cold-start invocations
  // can't both enter the reassignment loop and fight over the same
  // tableSession rows. We DO NOT clear the guard on failure — the price
  // of a one-off skip on shift change is much smaller than the price of
  // hammering UPDATE every 30 seconds for hours. Instead we set a
  // short backoff and let it retry once before giving up for the shift.
  lastReassignShift.set(realId, currentShift);

  try {
    const openSessions = await db.tableSession.findMany({
      where: { restaurantId: realId, status: "OPEN", waiterId: { not: null } },
      include: { waiter: { select: { id: true, shift: true } } },
    });

    const newShiftWaiters = await db.staff.findMany({
      where: { restaurantId: realId, role: "WAITER", active: true, shift: { in: [currentShift, 0] } },
      orderBy: { createdAt: "asc" },
    });

    if (newShiftWaiters.length > 0) {
      let assignIdx = 0;
      for (const sess of openSessions) {
        const waiterShift = sess.waiter?.shift || 0;
        if (waiterShift !== 0 && waiterShift !== currentShift) {
          const newWaiter = newShiftWaiters[assignIdx % newShiftWaiters.length];
          await db.tableSession.update({
            where: { id: sess.id },
            data: { waiterId: newWaiter.id },
          }).catch((err) => {
            // Session may have closed or been deleted between findMany and
            // update — log and keep going. One bad row shouldn't break the
            // whole poll for the entire restaurant.
            console.warn(`Skipped reassigning session ${sess.id}:`, err?.message || err);
          });
          assignIdx++;
        }
      }
    }
    // Success — clear any backoff that was set by a previous failure.
    reassignBackoffUntil.delete(realId);
  } catch (err) {
    // Don't clear the shift guard — that would re-enter the loop on the
    // very next poll. Set a backoff so we'll retry once after a few
    // minutes; if the second attempt also fails the shift is skipped
    // and the next shift change resets the cycle.
    lastReassignShift.delete(realId);
    reassignBackoffUntil.set(realId, Date.now() + REASSIGN_BACKOFF_MS);
    Sentry.captureException(err, { tags: { area: "live-snapshot.reassign" } });
    console.error("maybeReassignSessions failed:", err);
    // Swallow — reassignment is nice-to-have, not load-bearing for the
    // snapshot itself. The endpoint must keep serving.
  }
}

async function loadSessions(realId: string) {
  const currentShift = getCurrentShift();
  const shiftStart = getShiftStart(currentShift);

  // Auto-reassign: only runs once per shift change, not on every poll
  await maybeReassignSessions(realId, currentShift);

  const cairoNow = nowInRestaurantTz();
  const todayStartCairo = new Date(cairoNow.getFullYear(), cairoNow.getMonth(), cairoNow.getDate());
  const offset = new Date().getTime() - cairoNow.getTime();
  const todayStartUTC = new Date(todayStartCairo.getTime() + offset);

  const sessions = await db.tableSession.findMany({
    where: {
      restaurantId: realId,
      OR: [{ status: "OPEN" }, { closedAt: { gte: todayStartUTC } }],
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

  return {
    currentShift,
    shiftStart: shiftStart.toISOString(),
    sessions: sessions.map((s) => ({
      id: s.id,
      tableNumber: s.table?.number ?? null,
      orderType: s.orderType ?? "TABLE",
      vipGuestName: s.vipGuest?.name ?? null,
      guestCount: s.guestCount,
      waiterId: s.waiterId,
      waiterName: s.waiter?.name || null,
      openedAt: s.openedAt.toISOString(),
      menuOpenedAt: s.menuOpenedAt?.toISOString() || null,
      closedAt: s.closedAt?.toISOString() || null,
      status: s.status,
      orderCount: s.orders.filter((o) => o.status !== "CANCELLED").length,
      orderTotal: s.orders.filter((o) => o.status !== "CANCELLED").reduce((sum, o) => sum + toNum(o.total), 0),
      // What the cashier still needs to collect — excludes orders already
      // settled (paidAt stamped) and cancelled ones. A session where the
      // guest paid round 1 and then added round 2 shows only round 2 here,
      // so the cashier charges the delta and not the gross total again.
      unpaidTotal: s.orders
        .filter((o) => o.status !== "CANCELLED" && o.paidAt == null)
        .reduce((sum, o) => sum + toNum(o.total), 0),
      cashTotal: s.orders.filter((o) => o.paymentMethod === "CASH").reduce((sum, o) => sum + toNum(o.total), 0),
      paymentReceived:
        s.orders.length > 0 &&
        s.orders.every((o) => o.status === "CANCELLED" || o.paidAt != null),
      // Settlement history — one entry per distinct paidAt. Lets the
      // cashier see "Round 2 of 3 · already took 200 CASH + 150 CARD"
      // instead of staring at an ambiguous unpaid delta.
      paidRounds: computeSessionRounds(s.orders.map((o) => ({ ...o, total: toNum(o.total) }))),
      isCurrentShift: new Date(s.openedAt) >= shiftStart,
    })),
  };
}

// Sum tips across orders paid today (Cairo). Cheap aggregate query —
// returns a single number that the dashboard tile reads. Uses paidAt,
// not createdAt, so a tip collected at 00:10 counts toward today even
// if the order was placed at 23:50 yesterday.
async function sumTipsToday(realId: string): Promise<number> {
  try {
    const cairoNow = nowInRestaurantTz();
    const todayStartCairo = new Date(cairoNow.getFullYear(), cairoNow.getMonth(), cairoNow.getDate());
    const offset = new Date().getTime() - cairoNow.getTime();
    const todayStartUTC = new Date(todayStartCairo.getTime() + offset);
    const agg = await db.order.aggregate({
      where: {
        restaurantId: realId,
        paidAt: { gte: todayStartUTC },
        status: { not: "CANCELLED" },
      },
      _sum: { tip: true },
    });
    return Math.round(toNum(agg._sum.tip));
  } catch {
    // Not load-bearing — if this fails the tile shows 0, the rest of the
    // snapshot still serves.
    return 0;
  }
}

async function loadTables(realId: string) {
  const tables = await db.table.findMany({
    where: { restaurantId: realId },
    select: { id: true, number: true, label: true },
    orderBy: { number: "asc" },
  });
  return tables;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const rawId = url.searchParams.get("restaurantId") || "";

  try {
    let restaurantId = rawId ? await resolveRestaurantId(rawId) : null;
    if (!restaurantId) {
      const restaurant = await getDefaultRestaurant();
      restaurantId = restaurant?.id ?? null;
    }
    if (!restaurantId) {
      return NextResponse.json({ error: "restaurantId is required" }, { status: 400 });
    }

    // Sessions must complete before orders because loadSessions runs
    // the side-effect reassignment that can rewrite session.waiterId,
    // and downstream consumers expect orders and sessions to agree.
    const sessionData = await loadSessions(restaurantId);
    const [orders, tables, tipsToday] = await Promise.all([
      getOrdersForRestaurant(restaurantId),
      loadTables(restaurantId),
      sumTipsToday(restaurantId),
    ]);

    return NextResponse.json({
      orders,
      sessions: sessionData.sessions,
      currentShift: sessionData.currentShift,
      shiftStart: sessionData.shiftStart,
      tables,
      tipsToday,
    });
  } catch (err) {
    // Route handlers that catch and return 500 never reach Next's
    // onRequestError hook, so Sentry sees nothing. Capture explicitly
    // and log the full error + stack so we can actually diagnose
    // "crashing before logging" reports.
    const e = err as Error;
    Sentry.captureException(err, {
      tags: { area: "live-snapshot" },
      extra: { rawId, message: e?.message, stack: e?.stack },
    });
    console.error("Live snapshot failed:", {
      rawId,
      message: e?.message,
      name: e?.name,
      stack: e?.stack,
    });
    return NextResponse.json(
      { error: "Failed to load snapshot", message: e?.message || "unknown" },
      { status: 500 },
    );
  }
}
