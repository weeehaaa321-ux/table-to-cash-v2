import { NextRequest, NextResponse } from "next/server";
import { legacyDb as db } from "@/infrastructure/composition";
import { updateOrderStatus, closeSessionForOrder } from "@/lib/queries";
import { sendPushToStaff, sendPushToRole } from "@/lib/web-push";
import { getShiftTimer } from "@/lib/shifts";
import { autoAssignDelivery } from "@/lib/delivery-assignment";
import { requireStaffAuth } from "@/lib/api-auth";

// Order status updates come from kitchen, bar, waiter, cashier, delivery,
// and floor manager flows. Guests must never advance an order's state —
// the status transitions belong to staff alone.
const STATUS_ROLES = ["KITCHEN", "BAR", "WAITER", "CASHIER", "DELIVERY", "FLOOR_MANAGER", "OWNER"];

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/orders/[orderId]/status">
) {
  const { orderId } = await ctx.params;
  const body = await request.json();
  const { status, restaurantId, notes } = body;

  if (!status && !notes) {
    return NextResponse.json(
      { error: "status or notes is required" },
      { status: 400 }
    );
  }

  try {
    if (!restaurantId) {
      return NextResponse.json(
        { error: "restaurantId is required" },
        { status: 400 }
      );
    }

    const authed = await requireStaffAuth(request, STATUS_ROLES);
    if (authed instanceof NextResponse) return authed;

    // Restaurant scope — staff in restaurant A can't drive an order
    // belonging to restaurant B by knowing the orderId.
    const orderScope = await db.order.findUnique({
      where: { id: orderId },
      select: { restaurantId: true },
    });
    if (!orderScope || orderScope.restaurantId !== authed.restaurantId) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    // Enforce shift-based access: reject actions from off-shift staff.
    // Owner is exempt (always on duty for override flows).
    {
      const staff = await db.staff.findUnique({
        where: { id: authed.id },
        select: { shift: true, role: true },
      });
      if (staff && staff.shift !== 0 && staff.role !== "OWNER") {
        const timer = getShiftTimer(staff.shift, staff.role);
        if (!timer.isOnShift) {
          return NextResponse.json(
            { error: "Your shift has ended. You cannot update orders while off shift." },
            { status: 403 }
          );
        }
      }
    }

    // If the waiter marks a paid order as served, promote it directly to PAID
    // so the cashier's earlier payment confirmation is honored end-to-end.
    let effectiveStatus = status;
    if (status === "SERVED") {
      const existing = await db.order.findUnique({
        where: { id: orderId },
        select: { paymentMethod: true },
      });
      if (existing?.paymentMethod) effectiveStatus = "PAID";
    }

    const order = await updateOrderStatus(orderId, effectiveStatus, restaurantId, notes);

    // Auto-close session when order is paid
    if (effectiveStatus === "PAID") {
      await closeSessionForOrder(orderId).catch((err) =>
        console.error("Failed to close session:", err)
      );
    }

    // Push notifications for key status changes
    if (status === "READY" || status === "CONFIRMED" || status === "PREPARING") {
      const fullOrder = await db.order.findUnique({
        where: { id: orderId },
        include: {
          session: { select: { waiterId: true } },
          table: { select: { number: true } },
          deliveryDriver: { select: { id: true } },
        },
      });
      if (fullOrder) {
        const isDelivery = fullOrder.orderType === "DELIVERY";

        if (status === "READY" && fullOrder.session?.waiterId && !isDelivery) {
          sendPushToStaff(fullOrder.session.waiterId, {
            title: "Order Ready",
            body: `Order #${fullOrder.orderNumber} is ready — ${fullOrder.table ? `Table ${fullOrder.table.number}` : "VIP"}`,
            tag: `order-ready-${orderId}`,
            url: "/waiter",
          }).catch(() => {});
        }
        if (status === "CONFIRMED" && restaurantId) {
          const targetRole = fullOrder.station === "BAR" ? "BAR" : "KITCHEN";
          const targetUrl = fullOrder.station === "BAR" ? "/bar" : "/kitchen";
          sendPushToRole(targetRole, restaurantId, {
            title: "New Order",
            body: `Order #${fullOrder.orderNumber} confirmed — ${fullOrder.table ? `Table ${fullOrder.table.number}` : "VIP"}`,
            tag: `order-confirmed-${orderId}`,
            url: targetUrl,
          }).catch(() => {});
        }

        // Notify delivery driver on status changes
        if (isDelivery && fullOrder.deliveryDriver?.id) {
          const driverMsg =
            status === "CONFIRMED" ? "Order confirmed by kitchen" :
            status === "PREPARING" ? "Order is being prepared" :
            status === "READY" ? "Order is READY for pickup!" : null;
          if (driverMsg) {
            sendPushToStaff(fullOrder.deliveryDriver.id, {
              title: status === "READY" ? "Ready for Pickup!" : `Order #${fullOrder.orderNumber}`,
              body: `#${fullOrder.orderNumber} — ${driverMsg}`,
              tag: `delivery-status-${orderId}`,
              url: "/delivery",
            }).catch(() => {});
          }
        }

        // Auto-assign unassigned delivery orders when they become READY
        if (isDelivery && status === "READY" && !fullOrder.deliveryDriver?.id && restaurantId) {
          autoAssignDelivery(restaurantId, orderId).catch((err) =>
            console.error("Delivery auto-assign on READY failed:", err)
          );
        }
      }
    }

    return NextResponse.json(order);
  } catch (err) {
    console.error("Order status update failed:", err);
    return NextResponse.json(
      { error: "Failed to update order status" },
      { status: 500 }
    );
  }
}
