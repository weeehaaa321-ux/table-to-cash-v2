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
    // Menu changes are rare; allow CDN/browser to cache for 10s and
    // serve stale-while-revalidate for 60s. This shaves DB load on
    // repeat scans (a guest QR scan + page reload + menu fetch hits
    // the same data 3-5 times in 30 seconds otherwise).
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "public, s-maxage=10, stale-while-revalidate=60",
      },
    });
  } catch {
    return NextResponse.json({ error: "Failed to load menu" }, { status: 500 });
  }
}
