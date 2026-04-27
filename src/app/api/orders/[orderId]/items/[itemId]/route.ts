import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";
import { requireStaffAuth } from "@/lib/api-auth";

// Who can cancel vs comp. Cancel is damage control (wrong order, allergen
// miss) and every floor-facing role needs it. Comp writes off revenue so
// we keep it tighter — floor manager, owner, cashier. Back-of-house roles
// (KITCHEN/BAR) must flag the floor instead of self-authorising a comp.
const CANCEL_ROLES = ["OWNER", "FLOOR_MANAGER", "WAITER", "CASHIER"];
const COMP_ROLES = ["OWNER", "FLOOR_MANAGER", "CASHIER"];

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

  if (action !== "cancel" && action !== "comp") {
    return NextResponse.json(
      { error: "action must be 'cancel' or 'comp'" },
      { status: 400 },
    );
  }

  const authed = await requireStaffAuth(
    request,
    action === "comp" ? COMP_ROLES : CANCEL_ROLES,
  );
  if (authed instanceof NextResponse) return authed;

  const orderScope = await useCases.orders.getRestaurantOfOrder(orderId);
  if (!orderScope || orderScope.restaurantId !== authed.restaurantId) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  try {
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
