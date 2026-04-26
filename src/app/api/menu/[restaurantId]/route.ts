import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getMenuForRestaurant } from "@/lib/queries";
import { db } from "@/lib/db";
import { isStationAcceptingOrders } from "@/lib/shifts";
import { syncTodaySchedule } from "@/lib/schedule-sync";

async function resolveRestaurantId(id: string): Promise<string | null> {
  if (!id) return null;
  if (id.startsWith("c") && id.length > 10) return id;
  const r = await db.restaurant.findUnique({ where: { slug: id }, select: { id: true } });
  return r?.id || null;
}

export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/menu/[restaurantId]">
) {
  const { restaurantId: rawId } = await ctx.params;
  const restaurantId = await resolveRestaurantId(rawId);
  if (!restaurantId) {
    return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
  }

  try {
    await syncTodaySchedule(restaurantId);

    const [menu, stationStaff] = await Promise.all([
      getMenuForRestaurant(restaurantId),
      db.staff.findMany({
        where: {
          restaurantId,
          active: true,
          role: { in: ["KITCHEN", "BAR"] },
        },
        select: { role: true, shift: true },
      }),
    ]);

    const kitchenShifts = stationStaff.filter((s) => s.role === "KITCHEN").map((s) => s.shift);
    const barShifts = stationStaff.filter((s) => s.role === "BAR").map((s) => s.shift);

    const activeStations: string[] = [];
    if (isStationAcceptingOrders("KITCHEN", kitchenShifts)) activeStations.push("KITCHEN");
    if (isStationAcceptingOrders("BAR", barShifts)) activeStations.push("BAR");

    return NextResponse.json({ categories: menu, activeStations });
  } catch {
    return NextResponse.json(
      { error: "Failed to load menu" },
      { status: 500 }
    );
  }
}
