import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";
import { maybeCloseSession } from "@/lib/queries";
import { requireStaffAuth } from "@/lib/api-auth";

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
    const orderScope = await useCases.delivery.getOrderScope(orderId);
    if (!orderScope || orderScope.restaurantId !== authed.restaurantId) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    if (
      authed.role === "DELIVERY" &&
      orderScope.deliveryDriverId &&
      orderScope.deliveryDriverId !== authed.id
    ) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (driverId && authed.role === "DELIVERY" && driverId !== authed.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (deliveryStatus === "PICKED_UP") {
      const current = await useCases.delivery.getOrderStatus(orderId);
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

    const order = await useCases.delivery.applyStatusUpdate(orderId, data);

    if (deliveryStatus === "DELIVERED" && order.paidAt) {
      await useCases.delivery.markPaid(orderId);
      if (order.sessionId) {
        await maybeCloseSession(order.sessionId);
      }
    }

    if (deliveryStatus === "DELIVERED") {
      useCases.delivery.assignPending(order.restaurantId).catch((err) =>
        console.error("Failed to assign pending deliveries:", err)
      );
    }

    return NextResponse.json(order);
  } catch (err) {
    console.error("Delivery status update failed:", err);
    return NextResponse.json({ error: "Failed to update delivery status" }, { status: 500 });
  }
}
