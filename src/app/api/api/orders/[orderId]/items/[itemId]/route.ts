import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaffAuth } from "@/lib/api-auth";
import { toNum } from "@/lib/money";

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

  // Scope to caller's restaurant so staff in one restaurant can't touch
  // another's orders by knowing the orderId.
  const orderScope = await db.order.findUnique({
    where: { id: orderId },
    select: { restaurantId: true },
  });
  if (!orderScope || orderScope.restaurantId !== authed.restaurantId) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  try {
    const result = await db.$transaction(async (tx) => {
      if (action === "cancel") {
        await tx.orderItem.update({
          where: { id: itemId, orderId },
          data: { cancelled: true, cancelReason: reason || null, cancelledAt: new Date() },
        });
      } else {
        // Comp: item was made (kitchen cost already incurred) but guest
        // is not charged. Contributes 0 to order.total but stays on the
        // receipt at 0 EGP so the guest sees the gesture.
        await tx.orderItem.update({
          where: { id: itemId, orderId },
          data: {
            comped: true,
            compReason: reason || null,
            compedBy: authed.id,
            compedAt: new Date(),
          },
        });
      }

      // Effective total = sum of rows that are neither cancelled nor comped.
      // Rounded server-side so float drift doesn't accumulate across
      // many comp/cancel cycles on the same order.
      const effective = await tx.orderItem.findMany({
        where: { orderId, cancelled: false, comped: false },
        select: { price: true, quantity: true },
      });
      const newTotal = Math.round(
        effective.reduce((s, i) => s + toNum(i.price) * i.quantity, 0)
      );

      // "All gone" means both cancelled AND no paying items left. We only
      // flip to CANCELLED if *every* row is cancelled — a fully-comped
      // order is still a valid (free) order the kitchen will cook.
      const anyActive = await tx.orderItem.count({
        where: { orderId, cancelled: false },
      });

      if (anyActive === 0) {
        await tx.order.update({
          where: { id: orderId },
          data: { status: "CANCELLED", subtotal: 0, total: 0 },
        });
      } else {
        await tx.order.update({
          where: { id: orderId },
          data: { subtotal: newTotal, total: newTotal },
        });
      }

      return {
        newTotal,
        action,
        allCancelled: anyActive === 0,
      };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error(`Item ${action} failed:`, err);
    return NextResponse.json({ error: `Failed to ${action} item` }, { status: 500 });
  }
}
