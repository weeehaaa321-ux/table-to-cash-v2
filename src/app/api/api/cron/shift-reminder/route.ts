import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendPushToStaff } from "@/lib/web-push";
import { nowInRestaurantTz } from "@/lib/restaurant-config";
import { syncTodaySchedule } from "@/lib/schedule-sync";

// Shift start hours in Cairo time
const SHIFT_STARTS: Record<number, number> = { 1: 0, 2: 8, 3: 16 };

function getCairoHour(): number {
  const now = new Date();
  const cairoTime = nowInRestaurantTz(now);
  return cairoTime.getHours();
}

function getCairoMinutes(): number {
  const now = new Date();
  const cairoTime = nowInRestaurantTz(now);
  return cairoTime.getHours() * 60 + cairoTime.getMinutes();
}

// GET: Called by Vercel Cron every 30 minutes
// Sends a message to staff whose shift starts within the next hour
export async function GET(request: NextRequest) {
  // Verify cron secret to prevent unauthorized calls
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const cairoMinutes = getCairoMinutes();
    const cairoHour = getCairoHour();

    // Find which shift starts within the next 45-75 minutes (window around 1 hour)
    let targetShift: number | null = null;
    for (const [shift, startHour] of Object.entries(SHIFT_STARTS)) {
      const startMinutes = startHour * 60;
      let diff = startMinutes - cairoMinutes;
      if (diff < 0) diff += 1440; // wrap past midnight
      if (diff >= 45 && diff <= 75) {
        targetShift = parseInt(shift);
        break;
      }
    }

    if (!targetShift) {
      return NextResponse.json({ message: "No shift starting in ~1 hour", cairoHour });
    }

    const shiftLabels: Record<number, string> = {
      1: "Shift 1 (12AM - 8AM)",
      2: "Shift 2 (8AM - 4PM)",
      3: "Shift 3 (4PM - 12AM)",
    };

    // Find all restaurants (to send reminders for each)
    const restaurants = await db.restaurant.findMany({ select: { id: true, name: true } });

    let totalSent = 0;

    for (const restaurant of restaurants) {
      await syncTodaySchedule(restaurant.id);

      const staff = await db.staff.findMany({
        where: { restaurantId: restaurant.id, shift: targetShift, active: true },
        select: { id: true, name: true },
      });

      if (staff.length === 0) continue;

      // Check if we already sent a reminder for this shift today (avoid duplicates)
      const today = new Date();
      const todayStr = today.toISOString().split("T")[0];
      const existing = await db.message.findFirst({
        where: {
          restaurantId: restaurant.id,
          command: `shift_reminder_${targetShift}_${todayStr}`,
        },
      });

      if (existing) continue; // Already sent today

      // Send a reminder message + push for each staff member
      for (const s of staff) {
        const text = `Reminder: Your ${shiftLabels[targetShift]} starts in 1 hour. Get ready!`;
        await db.message.create({
          data: {
            type: "alert",
            from: "system",
            to: s.id,
            text,
            command: `shift_reminder_${targetShift}_${todayStr}`,
            restaurantId: restaurant.id,
          },
        });
        // Push notification — wakes sleeping phones
        sendPushToStaff(s.id, {
          title: "Shift Reminder",
          body: text,
          tag: `shift-reminder-${targetShift}-${todayStr}`,
          url: "/waiter",
        }).catch(() => {});
        totalSent++;
      }
    }

    return NextResponse.json({
      success: true,
      targetShift,
      cairoHour,
      remindersSent: totalSent,
    });
  } catch (err) {
    console.error("Shift reminder cron failed:", err);
    return NextResponse.json({ error: "Cron failed" }, { status: 500 });
  }
}
