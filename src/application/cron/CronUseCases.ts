import { db } from "@/lib/db";
import { sendPushToStaff } from "@/lib/web-push";
import { nowInRestaurantTz } from "@/lib/restaurant-config";
import { getShiftBounds } from "@/lib/shifts";
import { notifyPaymentConfirmation } from "@/lib/payment-notify";

const SHIFT_STARTS: Record<number, number> = { 1: 0, 2: 8, 3: 16 };
const SHIFT_LABELS: Record<number, string> = {
  1: "Shift 1 (12AM - 8AM)",
  2: "Shift 2 (8AM - 4PM)",
  3: "Shift 3 (4PM - 12AM)",
};

const AUTO_CLOCKOUT_GRACE_MS = 60 * 60 * 1000;  // 1 hour after shift end

// Hard cap on the "defer if work is in flight" path. A cashier who
// walks out mid-settlement, or a waiter sitting on stranded tables
// that never got reassigned, would otherwise stay clocked-in
// indefinitely. After this many ms past shift end, close anyway —
// the unfinished work stays in the DB for human cleanup, but the
// StaffShift no longer counts toward someone's hours.
const AUTO_CLOCKOUT_HARD_CAP_MS = 2 * 60 * 60 * 1000;  // 2 hours past shift end

// A pending payment older than this gets a push to active cashiers.
// Customer hit "Pay" -> cashier was supposed to confirm; if no one
// has within this window, surface it loudly so the table doesn't sit
// stuck. The check runs on the auto-clockout cron tick (every 5min).
const STUCK_PAYMENT_AGE_MS = 10 * 60 * 1000;  // 10 minutes

function cairoMinutes(): number {
  const t = nowInRestaurantTz(new Date());
  return t.getHours() * 60 + t.getMinutes();
}

// Given a clockIn instant, role, and scheduled shift number, return the
// real-UTC instant at which the staff member's *current* shift ends —
// i.e., the smallest shift-end time strictly after clockIn. Returns
// null for shift=0 (unassigned, handled by the 14h staleness backstop
// in ClockInOutUseCase, not by the cron).
//
// Restaurant-TZ midnight math mirrors lib/daily-close.ts: Vercel runs
// in UTC, so `new Date(y,m,d)` builds midnight-UTC of that calendar
// date. Subtracting the (real - tzNow) offset shifts that to the real
// UTC instant of the restaurant's local midnight on that date.
function shiftEndAfterClockIn(
  clockIn: Date,
  shift: number,
  role: string,
): Date | null {
  if (shift === 0) return null;
  const { end: endMin } = getShiftBounds(shift, role);

  const realNow = new Date();
  const tzNow = nowInRestaurantTz(realNow);
  const offset = realNow.getTime() - tzNow.getTime();

  const candidates: Date[] = [];
  for (const dayOffset of [-1, 0, 1, 2]) {
    const dayMidnightLocal = new Date(
      tzNow.getFullYear(),
      tzNow.getMonth(),
      tzNow.getDate() + dayOffset,
    );
    const realDayMidnight = new Date(dayMidnightLocal.getTime() + offset);
    candidates.push(new Date(realDayMidnight.getTime() + endMin * 60_000));
  }

  let chosen: Date | null = null;
  for (const c of candidates) {
    if (c.getTime() <= clockIn.getTime()) continue;
    if (!chosen || c.getTime() < chosen.getTime()) chosen = c;
  }
  return chosen;
}

export class CronUseCases {
  /** Find shifts starting in ~1 hour and notify scheduled staff. */
  async runShiftReminder(): Promise<{ message: string; sent?: number }> {
    const now = cairoMinutes();
    let targetShift: number | null = null;
    for (const [shift, startHour] of Object.entries(SHIFT_STARTS)) {
      const startMinutes = startHour * 60;
      let diff = startMinutes - now;
      if (diff < 0) diff += 1440;
      if (diff >= 45 && diff <= 75) {
        targetShift = parseInt(shift);
        break;
      }
    }
    if (!targetShift) return { message: "No shift starting in ~1 hour" };

    const restaurants = await db.restaurant.findMany({ select: { id: true, name: true } });
    let sent = 0;
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const tomorrow = new Date(todayStart);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

    for (const r of restaurants) {
      const scheduled = await db.shiftSchedule.findMany({
        where: {
          restaurantId: r.id,
          shift: targetShift,
          date: { gte: todayStart, lt: tomorrow },
        },
        select: { staffId: true },
      });
      for (const s of scheduled) {
        await sendPushToStaff(s.staffId, {
          title: `${SHIFT_LABELS[targetShift]} starts soon`,
          body: `Your shift starts in ~1 hour. Don't be late.`,
          tag: `shift-reminder-${s.staffId}-${targetShift}`,
          url: "/waiter",
        }).catch(() => {});
        sent++;
      }
    }
    return { message: "Reminders sent", sent };
  }

  /**
   * Close every open StaffShift whose scheduled shift ended more than
   * 1 hour ago. This is the *only* path that closes a shift now —
   * staff and floor managers can't clock out manually.
   *
   * Three safety layers on top of the deadline test:
   *
   *  - **Defer if work is in flight (within hard cap)**: a waiter with
   *    an open `TableSession`, or a cashier with an open
   *    `CashSettlement`, isn't closed at the soft deadline. Lets them
   *    finish without the gate slamming in mid-action.
   *
   *  - **Hard cap at deadline + 4h**: if work is *still* in flight 4
   *    hours past shift end (cashier walked out mid-settlement, no
   *    current-shift waiter ever showed up to absorb stranded tables),
   *    close anyway. The unfinished work stays in the DB for human
   *    cleanup; the StaffShift no longer counts toward hours.
   *
   *  - **Race-safe close**: `updateMany` with `clockOut: null` in the
   *    `where` clause means an end-shift initiated seconds before this
   *    runs won't get its `clockOut` overwritten by ours.
   *
   * Idempotent + safe to re-run. Shifts with `shift === 0` are
   * skipped — no defined end time, the 24h staleness backstop in
   * ClockInOutUseCase covers them.
   */
  async runAutoClockOut(): Promise<{ closed: number; skipped: number; checked: number; deferred: number; forced: number; nudgedCashiers: number }> {
    const now = new Date();
    const open = await db.staffShift.findMany({
      where: { clockOut: null },
      select: { id: true, staffId: true, clockIn: true },
    });

    // Always run the stuck-payments nudge at the end, even if there's
    // nothing to clock out — pending confirmations are independent of
    // shift state. Wraps the whole flow in a single helper.
    const finish = async (partial: {
      closed: number; skipped: number; deferred: number; forced: number;
    }) => {
      let nudgedCashiers = 0;
      try {
        const result = await this.notifyStuckPayments();
        nudgedCashiers = result.notified;
      } catch (err) {
        console.error("notifyStuckPayments failed:", err);
      }
      return { ...partial, checked: open.length, nudgedCashiers };
    };

    if (open.length === 0) {
      return finish({ closed: 0, skipped: 0, deferred: 0, forced: 0 });
    }

    const staff = await db.staff.findMany({
      where: { id: { in: open.map((s) => s.staffId) } },
      select: { id: true, role: true, shift: true },
    });
    const staffById = new Map(staff.map((s) => [s.id, s]));

    // First pass: figure out which shifts are past the soft deadline,
    // and tag the ones that are also past the hard cap so we know to
    // ignore "work in flight" for them.
    const dueShifts: { id: string; staffId: string; role: string; forced: boolean }[] = [];
    let skipped = 0;
    for (const shift of open) {
      const s = staffById.get(shift.staffId);
      if (!s || s.shift === 0) { skipped++; continue; }

      const shiftEnd = shiftEndAfterClockIn(shift.clockIn, s.shift, s.role);
      if (!shiftEnd) { skipped++; continue; }

      const deadline = shiftEnd.getTime() + AUTO_CLOCKOUT_GRACE_MS;
      if (now.getTime() <= deadline) { skipped++; continue; }

      const forced = now.getTime() > shiftEnd.getTime() + AUTO_CLOCKOUT_HARD_CAP_MS;
      dueShifts.push({ id: shift.id, staffId: s.id, role: s.role, forced });
    }

    if (dueShifts.length === 0) {
      return finish({ closed: 0, skipped, deferred: 0, forced: 0 });
    }

    // Bulk-check open work for the due staff (one query per kind, not
    // per staff). We fetch all the relevant counts in parallel.
    const waiterIds = dueShifts.filter((d) => d.role === "WAITER").map((d) => d.staffId);
    const cashierIds = dueShifts.filter((d) => d.role === "CASHIER").map((d) => d.staffId);

    const [busyWaiters, busyCashiers] = await Promise.all([
      // A waiter is "busy" only if they have a session with at least
      // one order that's still in active waiter territory: not paid,
      // no payment method requested yet, and not cancelled. A session
      // whose only unpaid orders are sitting on cashier confirmation
      // ISN'T waiter work — the waiter is done, the cashier is the
      // bottleneck. Without this filter, a waiter who handed off the
      // last order at 3:55 PM gets unfairly held on the clock just
      // because the cashier hasn't confirmed yet.
      waiterIds.length === 0
        ? Promise.resolve<{ waiterId: string | null }[]>([])
        : db.tableSession.findMany({
            where: {
              waiterId: { in: waiterIds },
              status: "OPEN",
              orders: {
                some: {
                  paidAt: null,
                  paymentMethod: null,
                  status: { not: "CANCELLED" },
                },
              },
            },
            select: { waiterId: true },
            distinct: ["waiterId"],
          }),
      cashierIds.length === 0
        ? Promise.resolve<{ cashierId: string }[]>([])
        : db.cashSettlement.findMany({
            where: { cashierId: { in: cashierIds }, status: { in: ["REQUESTED", "ACCEPTED"] } },
            select: { cashierId: true },
            distinct: ["cashierId"],
          }),
    ]);
    const busyStaff = new Set<string>([
      ...busyWaiters.map((w) => w.waiterId).filter((id): id is string => !!id),
      ...busyCashiers.map((c) => c.cashierId),
    ]);

    let closed = 0;
    let deferred = 0;
    let forcedCount = 0;
    for (const due of dueShifts) {
      const busy = busyStaff.has(due.staffId);
      if (busy && !due.forced) {
        // Mid-payment cashier or waiter still holding a table — defer.
        // Next cron tick will retry; reassign sweep will have moved
        // the table by then in normal flow.
        deferred++;
        continue;
      }
      // updateMany + clockOut:null filter so a concurrent end-shift
      // doesn't get its timestamp clobbered by ours.
      const result = await db.staffShift.updateMany({
        where: { id: due.id, clockOut: null },
        data: { clockOut: now },
      });
      if (result.count > 0) {
        closed++;
        if (busy && due.forced) forcedCount++;
      } else {
        skipped++;
      }
    }

    return finish({ closed, skipped, deferred, forced: forcedCount });
  }

  /**
   * Push-notify the right people about payments that have been "pay
   * requested" (paymentMethod set, paidAt still null) for longer than
   * the stuck threshold. Reuses the shared notifyPaymentConfirmation
   * helper so the targeting policy is identical to the immediate
   * pay-action push:
   *
   *   - On-shift cashiers (always)
   *   - OWNER + FLOOR_MANAGER (only if no on-shift cashier is on the
   *     floor right now)
   *   - Off-shift cashiers (never — they're not on the roster)
   *
   * The helper's tag scheme is per-recipient so re-runs REPLACE
   * rather than stack — each device sees one persistent notification.
   */
  private async notifyStuckPayments(): Promise<{ notified: number }> {
    const cutoff = new Date(Date.now() - STUCK_PAYMENT_AGE_MS);

    const stuck = await db.order.findMany({
      where: {
        paidAt: null,
        paymentMethod: { not: null },
        updatedAt: { lt: cutoff },
        status: { not: "CANCELLED" },
      },
      select: {
        restaurantId: true,
        session: {
          select: { table: { select: { number: true } } },
        },
      },
    });
    if (stuck.length === 0) return { notified: 0 };

    // Group by restaurant + collect distinct table numbers so the
    // notification body lists which tables are waiting.
    const byRestaurant = new Map<string, Set<number | null>>();
    for (const o of stuck) {
      const set = byRestaurant.get(o.restaurantId) ?? new Set<number | null>();
      set.add(o.session?.table?.number ?? null);
      byRestaurant.set(o.restaurantId, set);
    }

    let notified = 0;
    for (const [restaurantId, tableSet] of byRestaurant) {
      const numbered = Array.from(tableSet).filter((n): n is number => n != null).sort((a, b) => a - b);
      const hasVip = tableSet.has(null);
      const tableLabel = numbered.length > 0
        ? `Table${numbered.length > 1 ? "s" : ""} ${numbered.join(", ")}${hasVip ? " + VIP" : ""}`
        : "VIP session";
      const count = tableSet.size;

      await notifyPaymentConfirmation({
        restaurantId,
        title: count === 1 ? "Payment confirmation needed" : `${count} payments need confirmation`,
        body: `${tableLabel} — guest tapped Pay 10+ min ago.`,
        tagBase: `stuck-payments-${restaurantId}`,
      }).catch(() => {});
      notified++;
    }

    return { notified };
  }

  /** Fire any check_table messages whose scheduled time has passed. */
  async runTableCheck(): Promise<{ sent: number }> {
    const now = new Date();
    const messages = await db.message.findMany({
      where: { type: "check_table" },
      select: { id: true, to: true, text: true, command: true },
    });
    let sent = 0;
    for (const msg of messages) {
      const parts = msg.command?.split("_") || [];
      const isoDate = parts.slice(2).join("_");
      const scheduledAt = new Date(isoDate);
      if (isNaN(scheduledAt.getTime()) || scheduledAt > now) continue;

      await sendPushToStaff(msg.to, {
        title: "Check Table",
        body: msg.text || "Time to check on your table",
        tag: `table-check-${msg.id}`,
        url: "/waiter",
      }).catch(() => {});
      await db.message.delete({ where: { id: msg.id } }).catch(() => {});
      sent++;
    }
    return { sent };
  }
}
