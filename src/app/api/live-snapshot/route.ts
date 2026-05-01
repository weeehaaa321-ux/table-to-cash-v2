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

// Allow at most this much imbalance before rebalancing. ±1 means a
// 5-3 split sits, but a 5-2 split triggers a move. Larger values
// reduce reassign churn at the cost of more uneven loads.
const REBALANCE_TOLERANCE = 1;

// The reassign sweep. Runs on every snapshot poll (throttled), not just
// at shift boundaries. Two phases:
//
//   Phase A — fix broken assignments. A session is "broken" if its
//   waiter is missing (orphan), no longer clocked in (stranded), or
//   off-shift (waiter.shift not in {currentShift, 0}). Each broken
//   session moves to the least-loaded eligible waiter.
//
//   Phase B — rebalance. After phase A, if the load gap between the
//   most-loaded and least-loaded eligible waiter exceeds the tolerance,
//   move sessions from the heaviest to the lightest until the gap
//   closes. This catches the "first-to-clock-in absorbs everything,
//   later arrivals stay empty" case (e.g. shift change with 20
//   inherited tables, A clocks in at 4:01 and gets all 20, B clocks
//   in at 4:11 with nothing). We move the *newest* session each
//   iteration — newer sessions are likelier to still be in early
//   service (browsing/ordering) and less disruptive to swap.
//
// Targets are clocked-in waiters with shift in {currentShift, 0}.
// `assignWaiterToSession` writes the DB row only — no push notification
// fires from the sweep, so a rebalance move is invisible to the
// customer (only future routing changes).
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

    // Live map of session -> waiter that we update as we go. Starts
    // from DB state so phase A and phase B share one source of truth.
    const assignedTo = new Map<string, string | null>();
    for (const s of openSessions) assignedTo.set(s.id, s.waiterId);

    // ── Phase A: fix broken assignments ───────────────────────────
    const broken = openSessions.filter((s) => {
      const wid = assignedTo.get(s.id);
      if (!wid) return true;                                   // orphan
      if (!openSet.has(wid)) return true;                      // stranded
      const wShift = s.waiter?.shift ?? 0;
      if (wShift !== 0 && wShift !== currentShift) return true;// off-shift
      return false;
    });

    for (const sess of broken) {
      const target = pickLeastLoaded(eligible, assignedTo);
      await useCases.livePoll.assignWaiterToSession(sess.id, target).catch((err) => {
        console.warn(`Reassign failed for session ${sess.id}:`, err?.message || err);
      });
      assignedTo.set(sess.id, target);
    }

    // ── Phase B: rebalance ────────────────────────────────────────
    // Cap iterations at the total session count as a defence against
    // a bug-introduced infinite loop; in practice this exits as soon
    // as the gap is within tolerance.
    const maxIterations = openSessions.length;
    for (let i = 0; i < maxIterations; i++) {
      const loads = countLoads(eligible, assignedTo);
      const sorted = eligible
        .map((w) => ({ id: w.id, load: loads.get(w.id) ?? 0 }))
        .sort((a, b) => a.load - b.load);
      const min = sorted[0];
      const max = sorted[sorted.length - 1];
      if (max.load - min.load <= REBALANCE_TOLERANCE) break;

      // Pick the newest session held by max — least likely to be
      // mid-service, so the swap is least disruptive.
      const candidates = openSessions
        .filter((s) => assignedTo.get(s.id) === max.id)
        .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
      if (candidates.length === 0) break;
      const sess = candidates[0];

      await useCases.livePoll.assignWaiterToSession(sess.id, min.id).catch((err) => {
        console.warn(`Rebalance failed for session ${sess.id}:`, err?.message || err);
      });
      assignedTo.set(sess.id, min.id);
    }

    reassignBackoffUntil.delete(realId);
  } catch (err) {
    reassignBackoffUntil.set(realId, Date.now() + REASSIGN_BACKOFF_MS);
    Sentry.captureException(err, { tags: { area: "live-snapshot.reassign" } });
    console.error("reassignSweep failed:", err);
  }
}

function countLoads(
  eligible: { id: string }[],
  assignedTo: Map<string, string | null>,
): Map<string, number> {
  const loads = new Map<string, number>();
  for (const w of eligible) loads.set(w.id, 0);
  for (const wid of assignedTo.values()) {
    if (wid && loads.has(wid)) loads.set(wid, (loads.get(wid) ?? 0) + 1);
  }
  return loads;
}

function pickLeastLoaded(
  eligible: { id: string }[],
  assignedTo: Map<string, string | null>,
): string {
  const loads = countLoads(eligible, assignedTo);
  let target = eligible[0].id;
  let min = loads.get(target) ?? 0;
  for (const w of eligible) {
    const l = loads.get(w.id) ?? 0;
    if (l < min) { min = l; target = w.id; }
  }
  return target;
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
