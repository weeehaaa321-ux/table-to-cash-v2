import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";
import { requireStaffAuth } from "@/lib/api-auth";

// Who can cancel vs comp. Cancel is damage control (wrong order, allergen
// miss) and every floor-facing role needs it. Comp writes off revenue so
// we keep it tighter — floor manager, owner, cashier. Back-of-house roles
// (KITCHEN/BAR) must flag the floor instead of self-authorising a comp.
const CANCEL_ROLES = ["OWNER", "FLOOR_MANAGER", "WAITER", "CASHIER"];
const COMP_ROLES = ["OWNER", "FLOOR_MANAGER", "CASHIER"];
// Stopping an activity timer is part of the routine billing flow;
// waiters need it too (they run the kayak / pool / massage handoffs
// and stop the clock when the guest hands the gear back).
const STOP_ACTIVITY_ROLES = ["OWNER", "FLOOR_MANAGER", "WAITER", "CASHIER"];

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/orders/[orderId]/items/[itemId]">
) {
  const { orderId, itemId } = await ctx.params;
  const body = await request.json();
  const { action, reason } = body as {
    action?: string;
    reason?: string;
  };

  if (action !== "cancel" && action !== "comp" && action !== "stop_activity") {
    return NextResponse.json(
      { error: "action must be 'cancel', 'comp', or 'stop_activity'" },
      { status: 400 },
    );
  }

  const allowedRoles = action === "comp"
    ? COMP_ROLES
    : action === "stop_activity"
      ? STOP_ACTIVITY_ROLES
      : CANCEL_ROLES;
  const authed = await requireStaffAuth(request, allowedRoles);
  if (authed instanceof NextResponse) return authed;

  const orderScope = await useCases.orders.getRestaurantOfOrder(orderId);
  if (!orderScope || orderScope.restaurantId !== authed.restaurantId) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  try {
    if (action === "stop_activity") {
      const result = await useCases.orders.stopActivityTimer(orderId, itemId);
      if (!result.ok) {
        const code = result.reason === "not_found" ? 404 : 400;
        return NextResponse.json({ error: result.reason || "stop failed" }, { status: code });
      }
      return NextResponse.json({ ok: true });
    }
    const result = await useCases.orders.cancelOrCompItem({
      orderId,
      itemId,
      action,
      reason: reason || null,
      actorStaffId: authed.id,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error(`Item ${action} failed:`, err);
    return NextResponse.json({ error: `Failed to ${action} item` }, { status: 500 });
  }
}
