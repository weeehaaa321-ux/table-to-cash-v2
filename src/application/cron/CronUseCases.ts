import { db } from "@/lib/db";
import { sendPushToStaff } from "@/lib/web-push";
import { nowInRestaurantTz } from "@/lib/restaurant-config";

const SHIFT_STARTS: Record<number, number> = { 1: 0, 2: 8, 3: 16 };
const SHIFT_LABELS: Record<number, string> = {
  1: "Shift 1 (12AM - 8AM)",
  2: "Shift 2 (8AM - 4PM)",
  3: "Shift 3 (4PM - 12AM)",
};

function cairoMinutes(): number {
  const t = nowInRestaurantTz(new Date());
  return t.getHours() * 60 + t.getMinutes();
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
