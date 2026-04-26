import { db } from "@/lib/db";
import { nowInRestaurantTz } from "@/lib/restaurant-config";

const lastSync = new Map<string, string>();

export async function syncTodaySchedule(restaurantId: string): Promise<number> {
  const now = nowInRestaurantTz();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const cacheKey = `${restaurantId}:${todayStr}`;
  if (lastSync.get(restaurantId) === cacheKey) return 0;

  const todayStart = new Date(todayStr + "T00:00:00Z");
  const tomorrow = new Date(todayStart);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  const todaySchedules = await db.shiftSchedule.findMany({
    where: {
      restaurantId,
      date: { gte: todayStart, lt: tomorrow },
    },
    select: { staffId: true, shift: true },
  });

  let synced = 0;
  for (const entry of todaySchedules) {
    await db.staff.update({
      where: { id: entry.staffId },
      data: { shift: entry.shift },
    });
    synced++;
  }

  lastSync.set(restaurantId, cacheKey);
  return synced;
}

export function invalidateScheduleSync(restaurantId: string) {
  lastSync.delete(restaurantId);
}
