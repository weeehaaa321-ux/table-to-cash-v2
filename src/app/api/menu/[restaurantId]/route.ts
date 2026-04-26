import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { useCases } from "@/infrastructure/composition";

export async function GET(
  _req: NextRequest,
  ctx: RouteContext<"/api/menu/[restaurantId]">,
) {
  const { restaurantId: rawId } = await ctx.params;
  const restaurantId = await useCases.menuRead.resolveRestaurantId(rawId);
  if (!restaurantId) {
    return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
  }
  try {
    const result = await useCases.menuRead.forRestaurant(restaurantId);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "Failed to load menu" }, { status: 500 });
  }
}
