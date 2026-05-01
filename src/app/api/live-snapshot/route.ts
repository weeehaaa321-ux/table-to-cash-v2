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

// Throttle the reassign sweep to once per 10s per restaurant. Snapshot
// polls fire every 30s per active page, but multiple pages multiply
// that — capping prevents redundant DB work and write storms when N
// devices poll simultaneously. Failures back off for 5 min.
const lastReassignAt = new Map<string, number>();
const reassignBackoffUntil = new Map<string, number>();
const REASSIGN_THROTTLE_MS = 10 * 1000;
const REASSIGN_BACKOFF_MS = 5 * 60 * 1000;

// The reassign sweep. Runs on every snapshot poll (throttled), not just
// at shift boundaries. Three cases trigger a session move:
//   (1) waiterId is null              — orphaned, adopt it
//   (2) waiter is no longer clocked in — stranded (auto-cron'd, etc.)
//   (3) waiter.shift is neither currentShift nor 0 — past their shift
// Targets are clocked-in waiters with shift in [currentShift, 0]. Each
// move picks the least-loaded target so the load equalizes naturally
// over time. Already-correct assignments are not rebalanced — mid-meal
// waiter swaps would confuse customers, so a waiter who legitimately
// owns a session keeps it even if the load isn't perfectly even.
async function reassignSweep(realId: string, currentShift: number) {
  const last = lastReassignAt.get(realId) || 0;
  if (Date.now() - last < REASSIGN_THROTTLE_MS) return;

  const backoff = reassignBackoffUntil.get(realId) || 0;
  if (Date.now() < backoff) return;

  lastReassignAt.set(realId, Date.now());

  try {
    const [openSessions, shiftWaiters, openIds] = await Promise.all([
      useCases.livePoll.listAllOpenSessions(realId),
      useCases.livePoll.listWaitersForShifts(realId, [currentShift, 0]),
      useCases.clockInOut.listOpenStaffIds(),
    ]);

    const openSet = new Set(openIds);
    const eligible = shiftWaiters.filter((w) => openSet.has(w.id));
    if (eligible.length === 0) {
      // No one is clocked in for the current shift. Nothing we can do
      // here — floor mgr will pick orphans up manually until someone
      // taps the gate. Don't mark done; the next sweep retries.
      return;
    }

    const toReassign = openSessions.filter((s) => {
      // (1) orphan-waiter session
      if (!s.waiterId) return true;
      // (2) waiter not clocked in (auto-cron'd or never showed up)
      if (!openSet.has(s.waiterId)) return true;
      // (3) waiter's shift no longer current
      const wShift = s.waiter?.shift ?? 0;
      if (wShift !== 0 && wShift !== currentShift) return true;
      return false;
    });

    if (toReassign.length === 0) {
      reassignBackoffUntil.delete(realId);
      return;
    }

    // Build current load only from sessions we're keeping (i.e., those
    // already correctly assigned to an eligible waiter). New writes
    // from this loop increment their target's load so subsequent picks
    // distribute evenly.
    const load = new Map<string, number>();
    for (const w of eligible) load.set(w.id, 0);
    const reassignSet = new Set(toReassign.map((s) => s.id));
    for (const sess of openSessions) {
      if (reassignSet.has(sess.id)) continue;
      if (sess.waiterId && load.has(sess.waiterId)) {
        load.set(sess.waiterId, (load.get(sess.waiterId) || 0) + 1);
      }
    }

    for (const sess of toReassign) {
      let target = eligible[0].id;
      let minLoad = load.get(target) ?? 0;
      for (const w of eligible) {
        const l = load.get(w.id) ?? 0;
        if (l < minLoad) { minLoad = l; target = w.id; }
      }
      await useCases.livePoll.assignWaiterToSession(sess.id, target).catch((err) => {
        console.warn(`Reassign failed for session ${sess.id}:`, err?.message || err);
      });
      load.set(target, (load.get(target) ?? 0) + 1);
    }
    reassignBackoffUntil.delete(realId);
  } catch (err) {
    reassignBackoffUntil.set(realId, Date.now() + REASSIGN_BACKOFF_MS);
    Sentry.captureException(err, { tags: { area: "live-snapshot.reassign" } });
    console.error("reassignSweep failed:", err);
  }
}

async function loadSessions(realId: string) {
  const currentShift = getCurrentShift();
  const shiftStart = getShiftStart(currentShift);

  await reassignSweep(realId, currentShift);

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
