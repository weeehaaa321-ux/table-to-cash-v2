// Wraps legacy `lib/queries.getMenuForRestaurant` + `lib/shifts.isStationAcceptingOrders`
// + `lib/schedule-sync.syncTodaySchedule`. Existing route logic preserved verbatim;
// only the import path moves from route → here.
import { getMenuForRestaurant } from "@/lib/queries";
import { isStationAcceptingOrders } from "@/lib/shifts";
import { syncTodaySchedule } from "@/lib/schedule-sync";
import { db } from "@/lib/db";

export class MenuReadUseCase {
  async forRestaurant(restaurantId: string): Promise<{ categories: unknown; activeStations: string[] }> {
    await syncTodaySchedule(restaurantId);
    const [menu, stationStaff] = await Promise.all([
      getMenuForRestaurant(restaurantId),
      db.staff.findMany({
        where: { restaurantId, active: true, role: { in: ["KITCHEN", "BAR"] } },
        select: { role: true, shift: true },
      }),
    ]);
    const kitchenShifts = stationStaff.filter((s) => s.role === "KITCHEN").map((s) => s.shift);
    const barShifts = stationStaff.filter((s) => s.role === "BAR").map((s) => s.shift);
    const activeStations: string[] = [];
    if (isStationAcceptingOrders("KITCHEN", kitchenShifts)) activeStations.push("KITCHEN");
    if (isStationAcceptingOrders("BAR", barShifts)) activeStations.push("BAR");
    // Activities don't depend on a station's shift coverage — there's
    // no kitchen / bar staff to be on duty for them. They're always
    // open as long as the restaurant is.
    activeStations.push("ACTIVITY");
    return { categories: menu, activeStations };
  }

  async resolveRestaurantId(id: string): Promise<string | null> {
    if (!id) return null;
    if (id.startsWith("c") && id.length > 10) return id;
    const r = await db.restaurant.findUnique({ where: { slug: id }, select: { id: true } });
    return r?.id || null;
  }
}
