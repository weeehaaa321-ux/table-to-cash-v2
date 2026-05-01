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
   * staff and floor managers can't clock out manually. The 1h grace
   * covers cleanup time after the shift technically ends.
   *
   * Idempotent + safe to re-run: each row is checked independently,
   * and the update target (`clockOut`) is the closure timestamp itself.
   * Shifts with `shift === 0` (unassigned) are skipped — there's no
   * defined end time for them, so the 14h staleness filter in
   * ClockInOutUseCase is the backstop instead.
   */
  async runAutoClockOut(): Promise<{ closed: number; skipped: number; checked: number }> {
    const now = new Date();
    const open = await db.staffShift.findMany({
      where: { clockOut: null },
      select: { id: true, staffId: true, clockIn: true },
    });
    if (open.length === 0) return { closed: 0, skipped: 0, checked: 0 };

    const staff = await db.staff.findMany({
      where: { id: { in: open.map((s) => s.staffId) } },
      select: { id: true, role: true, shift: true },
    });
    const staffById = new Map(staff.map((s) => [s.id, s]));

    let closed = 0;
    let skipped = 0;

    for (const shift of open) {
      const s = staffById.get(shift.staffId);
      if (!s || s.shift === 0) { skipped++; continue; }

      const shiftEnd = shiftEndAfterClockIn(shift.clockIn, s.shift, s.role);
      if (!shiftEnd) { skipped++; continue; }

      const deadline = shiftEnd.getTime() + AUTO_CLOCKOUT_GRACE_MS;
      if (now.getTime() <= deadline) { skipped++; continue; }

      await db.staffShift.update({
        where: { id: shift.id },
        data: { clockOut: now },
      });
      closed++;
    }

    return { closed, skipped, checked: open.length };
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
