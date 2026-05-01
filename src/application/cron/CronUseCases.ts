import { db } from "@/lib/db";
import { sendPushToStaff } from "@/lib/web-push";
import { nowInRestaurantTz } from "@/lib/restaurant-config";
import { getShiftBounds } from "@/lib/shifts";

const SHIFT_STARTS: Record<number, number> = { 1: 0, 2: 8, 3: 16 };
const SHIFT_LABELS: Record<number, string> = {
  1: "Shift 1 (12AM - 8AM)",
  2: "Shift 2 (8AM - 4PM)",
  3: "Shift 3 (4PM - 12AM)",
};

const AUTO_CLOCKOUT_GRACE_MS = 60 * 60 * 1000;  // 1 hour after shift end

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
   * Two safety checks layered on top of the deadline test:
   *
   *  - **Defer if work is in flight**: a waiter with an open
   *    `TableSession`, or a cashier with an open `CashSettlement`,
   *    isn't closed even if past deadline. Lets them finish what
   *    they're doing without the gate slamming in mid-action. The
   *    reassign sweep will normally have moved the waiter's tables
   *    by then; if not, we wait.
   *
   *  - **Race-safe close**: `updateMany` with `clockOut: null` in the
   *    `where` clause means an end-shift initiated seconds before this
   *    runs won't get its `clockOut` overwritten by ours.
   *
   * Idempotent + safe to re-run. Shifts with `shift === 0` are
   * skipped — no defined end time, the 24h staleness backstop in
   * ClockInOutUseCase covers them.
   */
  async runAutoClockOut(): Promise<{ closed: number; skipped: number; checked: number; deferred: number }> {
    const now = new Date();
    const open = await db.staffShift.findMany({
      where: { clockOut: null },
      select: { id: true, staffId: true, clockIn: true },
    });
    if (open.length === 0) return { closed: 0, skipped: 0, deferred: 0, checked: 0 };

    const staff = await db.staff.findMany({
      where: { id: { in: open.map((s) => s.staffId) } },
      select: { id: true, role: true, shift: true },
    });
    const staffById = new Map(staff.map((s) => [s.id, s]));

    // First pass: figure out which shifts are even past deadline. We
    // only need to check "work in flight" for those — saves a pile of
    // queries on every cron tick (most shifts are well within their
    // window).
    const dueShifts: { id: string; staffId: string; role: string }[] = [];
    let skipped = 0;
    for (const shift of open) {
      const s = staffById.get(shift.staffId);
      if (!s || s.shift === 0) { skipped++; continue; }

      const shiftEnd = shiftEndAfterClockIn(shift.clockIn, s.shift, s.role);
      if (!shiftEnd) { skipped++; continue; }

      const deadline = shiftEnd.getTime() + AUTO_CLOCKOUT_GRACE_MS;
      if (now.getTime() <= deadline) { skipped++; continue; }

      dueShifts.push({ id: shift.id, staffId: s.id, role: s.role });
    }

    if (dueShifts.length === 0) {
      return { closed: 0, skipped, deferred: 0, checked: open.length };
    }

    // Bulk-check open work for the due staff (one query per kind, not
    // per staff). We fetch all the relevant counts in parallel.
    const waiterIds = dueShifts.filter((d) => d.role === "WAITER").map((d) => d.staffId);
    const cashierIds = dueShifts.filter((d) => d.role === "CASHIER").map((d) => d.staffId);

    const [busyWaiters, busyCashiers] = await Promise.all([
      waiterIds.length === 0
        ? Promise.resolve<{ waiterId: string | null }[]>([])
        : db.tableSession.findMany({
            where: { waiterId: { in: waiterIds }, status: "OPEN" },
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
    for (const due of dueShifts) {
      if (busyStaff.has(due.staffId)) {
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
      if (result.count > 0) closed++;
      else skipped++;
    }

    return { closed, skipped, deferred, checked: open.length };
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
