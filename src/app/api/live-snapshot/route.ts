import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { useCases } from "@/infrastructure/composition";
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

// Per-Lambda state: only run reassignment once per shift per restaurant
// (not on every poll). lastReassignShift tracks the shift we last ran;
// reassignBackoffUntil prevents a hot-loop after a failure.
const lastReassignShift = new Map<string, number>();
const reassignBackoffUntil = new Map<string, number>();
const REASSIGN_BACKOFF_MS = 5 * 60 * 1000;

async function maybeReassignSessions(realId: string, currentShift: number) {
  const lastShift = lastReassignShift.get(realId);
  if (lastShift === currentShift) return;

  const backoff = reassignBackoffUntil.get(realId) || 0;
  if (Date.now() < backoff) return;

  // Don't mark this shift as "done" up-front. If the new-shift waiter
  // hasn't clocked in yet, the run below will be a no-op AND we want
  // the next snapshot poll to retry (otherwise stale-shift sessions
  // stay glued to the previous shift's waiter — who's been auto-
  // clocked-out an hour later — for the rest of the day).

  try {
    const [openSessions, shiftWaiters, openIds] = await Promise.all([
      useCases.livePoll.listOpenSessionsWithWaiterShift(realId),
      useCases.livePoll.listWaitersForShifts(realId, [currentShift, 0]),
      useCases.clockInOut.listOpenStaffIds(),
    ]);
    // Only push tables onto waiters who are clocked in now. A scheduled
    // waiter who hasn't shown up yet shouldn't accumulate tables that
    // they aren't there to serve.
    const openSet = new Set(openIds);
    const newShiftWaiters = shiftWaiters.filter((w) => openSet.has(w.id));
    const sessionsToReassign = openSessions.filter((s) => {
      const w = s.waiter?.shift || 0;
      return w !== 0 && w !== currentShift;
    });

    if (sessionsToReassign.length === 0) {
      // Nothing was on the wrong shift in the first place — mark done,
      // no need to keep checking until the next shift change.
      lastReassignShift.set(realId, currentShift);
    } else if (newShiftWaiters.length === 0) {
      // Sessions need a new home but nobody is clocked in for the new
      // shift yet. Leave lastReassignShift unset so the next snapshot
      // poll retries — we'll keep checking until at least one shift
      // waiter taps the gate.
    } else {
      let assignIdx = 0;
      for (const sess of sessionsToReassign) {
        const newWaiter = newShiftWaiters[assignIdx % newShiftWaiters.length];
        await useCases.livePoll.assignWaiterToSession(sess.id, newWaiter.id).catch((err) => {
          console.warn(`Skipped reassigning session ${sess.id}:`, err?.message || err);
        });
        assignIdx++;
      }
      lastReassignShift.set(realId, currentShift);
    }
    reassignBackoffUntil.delete(realId);
  } catch (err) {
    lastReassignShift.delete(realId);
    reassignBackoffUntil.set(realId, Date.now() + REASSIGN_BACKOFF_MS);
    Sentry.captureException(err, { tags: { area: "live-snapshot.reassign" } });
    console.error("maybeReassignSessions failed:", err);
  }
}

async function loadSessions(realId: string) {
  const currentShift = getCurrentShift();
  const shiftStart = getShiftStart(currentShift);

  await maybeReassignSessions(realId, currentShift);

  const cairoNow = nowInRestaurantTz();
  const todayStartCairo = new Date(cairoNow.getFullYear(), cairoNow.getMonth(), cairoNow.getDate());
  const offset = new Date().getTime() - cairoNow.getTime();
  const todayStartUTC = new Date(todayStartCairo.getTime() + offset);

  const sessions = await useCases.livePoll.listSessionsForSnapshot(realId, todayStartUTC);

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
      unpaidTotal: s.orders
        .filter((o) => o.status !== "CANCELLED" && o.paidAt == null)
        .reduce((sum, o) => sum + toNum(o.total), 0),
      cashTotal: s.orders.filter((o) => o.paymentMethod === "CASH").reduce((sum, o) => sum + toNum(o.total), 0),
      paymentReceived:
        s.orders.length > 0 &&
        s.orders.every((o) => o.status === "CANCELLED" || o.paidAt != null),
      paidRounds: computeSessionRounds(s.orders.map((o) => ({ ...o, total: toNum(o.total) }))),
      isCurrentShift: new Date(s.openedAt) >= shiftStart,
    })),
  };
}

async function sumTipsToday(realId: string): Promise<number> {
  try {
    const cairoNow = nowInRestaurantTz();
    const todayStartCairo = new Date(cairoNow.getFullYear(), cairoNow.getMonth(), cairoNow.getDate());
    const offset = new Date().getTime() - cairoNow.getTime();
    const todayStartUTC = new Date(todayStartCairo.getTime() + offset);
    return await useCases.livePoll.sumTipsSince(realId, todayStartUTC);
  } catch {
    return 0;
  }
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

    const sessionData = await loadSessions(restaurantId);
    const [orders, tables, tipsToday, openStaffIds] = await Promise.all([
      getOrdersForRestaurant(restaurantId),
      useCases.livePoll.listTables(restaurantId),
      sumTipsToday(restaurantId),
      // Folded in so the dashboard doesn't need a separate /api/clock
      // poll for the "On Shift Now" bulbs — the use case already
      // filters out stale shifts.
      useCases.clockInOut.listOpenStaffIds(),
    ]);

    return NextResponse.json({
      orders,
      sessions: sessionData.sessions,
      currentShift: sessionData.currentShift,
      shiftStart: sessionData.shiftStart,
      tables,
      tipsToday,
      openStaffIds,
    });
  } catch (err) {
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
