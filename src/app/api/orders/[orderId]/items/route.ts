import { NextRequest, NextResponse } from "next/server";
import { appendItemsToOrder, AppendItemsError } from "@/lib/queries";
import { requireStaffAuth } from "@/lib/api-auth";
import { db } from "@/lib/db";

// ─── POST: Append items to an existing order ────
//
// Floor-side flow only — guests add items via the normal POST /api/orders
// path, which runs through availability/session checks. This endpoint
// exists for waiters/floor-managers/cashiers to bolt items onto an
// existing order mid-meal. Anyone in the customer-facing roles is fine;
// kitchen/bar staff don't add things they didn't make.
const ALLOWED_ROLES = ["OWNER", "FLOOR_MANAGER", "WAITER", "CASHIER"];

export async function POST(
  request: NextRequest,
  ctx: RouteContext<"/api/orders/[orderId]/items">
) {
  const { orderId } = await ctx.params;
  const body = await request.json();
  const { items } = body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: "items array is required" }, { status: 400 });
  }

  const authed = await requireStaffAuth(request, ALLOWED_ROLES);
  if (authed instanceof NextResponse) return authed;

  // Restaurant scope check — staff in restaurant A must not be able to
  // append items to an order in restaurant B by passing its orderId.
  const orderScope = await db.order.findUnique({
    where: { id: orderId },
    select: { restaurantId: true },
  });
  if (!orderScope || orderScope.restaurantId !== authed.restaurantId) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  try {
    const order = await appendItemsToOrder(orderId, items);
    return NextResponse.json(order);
  } catch (err) {
    if (err instanceof AppendItemsError) {
      if (err.code === "ITEMS_UNAVAILABLE") {
        return NextResponse.json(
          { error: "ITEMS_UNAVAILABLE", items: err.detail },
          { status: 409 },
        );
      }
      if (err.code === "ORDER_NOT_FOUND") {
        return NextResponse.json({ error: "Order not found" }, { status: 404 });
      }
    }
    console.error("Failed to append items:", err);
    return NextResponse.json({ error: "Failed to append items" }, { status: 500 });
  }
}
