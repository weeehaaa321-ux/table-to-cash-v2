import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";
import { requireOwnerAuth } from "@/lib/api-auth";

// POST: Clear all orders, sessions, and messages for a restaurant
// Used for fresh start or end-of-shift cleanup
// With goLive: true — wipes ALL transactional data for a clean production start
//
// Owner-only — this is the most destructive endpoint in the system. Anyone
// who could call this unauthenticated could nuke the cafe's daily revenue
// records in one HTTP request, so identity must come from the signed
// header, never the body.
export async function POST(request: NextRequest) {
  const authed = await requireOwnerAuth(request);
  if (authed instanceof NextResponse) return authed;

  const body = await request.json();
  const { restaurantId, shiftOnly, goLive } = body;

  if (!restaurantId) {
    return NextResponse.json({ error: "restaurantId required" }, { status: 400 });
  }

  try {
    const realId = await useCases.admin.resolveRestaurantId(restaurantId);
    if (!realId) {
      return NextResponse.json({ error: "Restaurant not found" }, { status: 400 });
    }
    if (realId !== authed.restaurantId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (goLive) {
      const deleted = await useCases.admin.goLiveReset(realId);
      return NextResponse.json({ success: true, goLive: true, deleted });
    }

    let since: Date | undefined;
    if (shiftOnly) {
      since = new Date();
      since.setHours(0, 0, 0, 0);
    }

    const deleted = await useCases.admin.clearTransactional(realId, since);
    return NextResponse.json({ success: true, deleted });
  } catch (err) {
    console.error("Clear failed:", err);
    return NextResponse.json({ error: "Failed to clear data" }, { status: 500 });
  }
}
