import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { maybeCloseSession } from "@/lib/queries";
import { assignPendingDeliveries } from "@/lib/delivery-assignment";
import { requireStaffAuth } from "@/lib/api-auth";

// Driver-side and floor-side both update delivery status.
// FLOOR_MANAGER/OWNER can override (e.g. mark delivered after a comms
// failure with the driver). Guests must not be able to update status.
const DELIVERY_ROLES = ["DELIVERY", "FLOOR_MANAGER", "OWNER", "CASHIER"];

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/delivery/[orderId]/status">
) {
  const { orderId } = await ctx.params;
  const body = await request.json();
  const { deliveryStatus, driverId } = body;

  if (!deliveryStatus) {
    return NextResponse.json({ error: "deliveryStatus required" }, { status: 400 });
  }

  const validStatuses = ["ASSIGNED", "PICKED_UP", "ON_THE_WAY", "DELIVERED"];
  if (!validStatuses.includes(deliveryStatus)) {
    return NextResponse.json({ error: "Invalid delivery status" }, { status: 400 });
  }

  const authed = await requireStaffAuth(request, DELIVERY_ROLES);
  if (authed instanceof NextResponse) return authed;

  try {
    // Restaurant scope check — driver in restaurant A can't push status
    // on a delivery in restaurant B by knowing the orderId.
    const orderScope = await db.order.findUnique({
      where: { id: orderId },
      select: { restaurantId: true, deliveryDriverId: true },
    });
    if (!orderScope || orderScope.restaurantId !== authed.restaurantId) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    // Drivers can only act on their own assigned orders. Manager/owner
    // can override; cashier needs it for a few operational corner-cases
    // (e.g. closing out a delivery when the driver's phone died).
    if (
      authed.role === "DELIVERY" &&
      orderScope.deliveryDriverId &&
      orderScope.deliveryDriverId !== authed.id
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    // If driverId is being claimed (initial assignment), it must match
    // the caller for delivery role — drivers can self-assign their own
    // pending orders, not someone else's.
    if (driverId && authed.role === "DELIVERY" && driverId !== authed.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // PICKED_UP requires kitchen to have the food READY — can't take what isn't cooked
    if (deliveryStatus === "PICKED_UP") {
      const current = await db.order.findUnique({
        where: { id: orderId },
        select: { status: true },
      });
      if (!current) {
        return NextResponse.json({ error: "Order not found" }, { status: 404 });
      }
      if (current.status !== "READY" && current.status !== "SERVED" && current.status !== "PAID") {
        return NextResponse.json({ error: `Can't pick up yet — kitchen status is ${current.status}, food must be READY` }, { status: 400 });
      }
    }

    const now = new Date();
    const data: Record<string, unknown> = {
      deliveryStatus,
      ...(driverId ? { deliveryDriverId: driverId } : {}),
    };

    if (deliveryStatus === "PICKED_UP") {
      data.pickedUpAt = now;
    } else if (deliveryStatus === "DELIVERED") {
      data.deliveredAt = now;
      data.status = "SERVED";
      data.servedAt = now;
    }

    const order = await db.order.update({
      where: { id: orderId },
      data: data as never,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        deliveryStatus: true,
        sessionId: true,
        paymentMethod: true,
        paidAt: true,
        restaurantId: true,
      },
    });

    // Auto-close ONLY when the cashier has actually confirmed payment
    // (paidAt stamped). The earlier check trusted any non-null
    // paymentMethod, but paymentMethod is set the moment the guest
    // taps "pay" — long before the cashier collects the cash. That
    // bug auto-PAID delivery orders the cashier never confirmed,
    // and the cash counted toward drawer expectedCash even though it
    // was in the driver's pocket. Now we require paidAt.
    if (deliveryStatus === "DELIVERED" && order.paidAt) {
      await db.order.update({
        where: { id: orderId },
        data: { status: "PAID" },
        select: { id: true },
      });
      if (order.sessionId) {
        await maybeCloseSession(order.sessionId);
      }
    }

    // When a driver finishes a delivery, try to assign pending orders to them
    if (deliveryStatus === "DELIVERED") {
      assignPendingDeliveries(order.restaurantId).catch((err) =>
        console.error("Failed to assign pending deliveries:", err)
      );
    }

    return NextResponse.json(order);
  } catch (err) {
    console.error("Delivery status update failed:", err);
    return NextResponse.json({ error: "Failed to update delivery status" }, { status: 500 });
  }
}
