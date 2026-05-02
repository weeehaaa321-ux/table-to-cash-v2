import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";
import { closeSessionForOrder, StaleStatusTransitionError } from "@/lib/queries";
import { sendPushToStaff, sendPushToRole } from "@/lib/web-push";
import { getShiftTimer } from "@/lib/shifts";
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

    const orderScope = await useCases.orders.getRestaurantOfOrder(orderId);
    if (!orderScope || orderScope.restaurantId !== authed.restaurantId) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    {
      const staff = await useCases.orders.getStaffShiftRole(authed.id);
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

    let effectiveStatus = status;
    if (status === "SERVED") {
      const existing = await useCases.orders.getOrderPaymentMethod(orderId);
      if (existing?.paymentMethod) effectiveStatus = "PAID";
    }

    // Use the authenticated staff's restaurantId (a CUID) for the
    // scoped update — not the body's restaurantId, which different
    // callers send as either CUID or slug. The auth header already
    // pins the scope; body restaurantId is redundant.
    const order = await useCases.orders.updateStatus(orderId, effectiveStatus, authed.restaurantId, notes);

    // Auto-close session when order is paid
    if (effectiveStatus === "PAID") {
      await closeSessionForOrder(orderId).catch((err) =>
        console.error("Failed to close session:", err)
      );
    }

    // Push notifications for key status changes — sent with both
    // English and Arabic strings; web-push.ts picks per recipient
    // based on their stored subscription language.
    if (status === "READY" || status === "CONFIRMED" || status === "PREPARING") {
      const fullOrder = await useCases.orders.findOrderForPushContext(orderId);
      if (fullOrder) {
        const isDelivery = fullOrder.orderType === "DELIVERY";
        const tableEn = fullOrder.table ? `Table ${fullOrder.table.number}` : "VIP";
        const tableAr = fullOrder.table ? `طاولة ${fullOrder.table.number}` : "VIP";

        // Await all push sends so Vercel doesn't terminate the
        // function with in-flight webpush HTTP requests still
        // open. Same root cause as the messages-route slow-
        // commands bug: fire-and-forget on serverless = some
        // sends get dropped or stalled. Capped at 3s so a
        // weird endpoint can't stall the route response.
        const orderPushes: Promise<unknown>[] = [];
        if (status === "READY" && fullOrder.session?.waiterId && !isDelivery) {
          orderPushes.push(sendPushToStaff(fullOrder.session.waiterId, {
            title: { en: "Order Ready", ar: "الطلب جاهز" },
            body: {
              en: `Order #${fullOrder.orderNumber} is ready — ${tableEn}`,
              ar: `الطلب رقم ${fullOrder.orderNumber} جاهز — ${tableAr}`,
            },
            tag: `order-ready-${orderId}`,
            url: "/waiter",
          }).catch(() => {}));
        }
        if (status === "CONFIRMED" && restaurantId) {
          const targetRole = fullOrder.station === "BAR" ? "BAR" : "KITCHEN";
          const targetUrl = fullOrder.station === "BAR" ? "/bar" : "/kitchen";
          orderPushes.push(sendPushToRole(targetRole, restaurantId, {
            title: { en: "New Order", ar: "طلب جديد" },
            body: {
              en: `Order #${fullOrder.orderNumber} confirmed — ${tableEn}`,
              ar: `تم تأكيد الطلب رقم ${fullOrder.orderNumber} — ${tableAr}`,
            },
            tag: `order-confirmed-${orderId}`,
            url: targetUrl,
          }).catch(() => {}));
        }

        // Notify delivery driver on status changes
        if (isDelivery && fullOrder.deliveryDriver?.id) {
          const driverMsg = status === "CONFIRMED"
            ? { en: "Order confirmed by kitchen", ar: "تم تأكيد الطلب من المطبخ" }
            : status === "PREPARING"
              ? { en: "Order is being prepared", ar: "جاري تحضير الطلب" }
              : status === "READY"
                ? { en: "Order is READY for pickup!", ar: "الطلب جاهز للاستلام!" }
                : null;
          if (driverMsg) {
            orderPushes.push(sendPushToStaff(fullOrder.deliveryDriver.id, {
              title: status === "READY"
                ? { en: "Ready for Pickup!", ar: "جاهز للاستلام!" }
                : { en: `Order #${fullOrder.orderNumber}`, ar: `الطلب رقم ${fullOrder.orderNumber}` },
              body: {
                en: `#${fullOrder.orderNumber} — ${driverMsg.en}`,
                ar: `رقم ${fullOrder.orderNumber} — ${driverMsg.ar}`,
              },
              tag: `delivery-status-${orderId}`,
              url: "/delivery",
            }).catch(() => {}));
          }
        }

        if (orderPushes.length > 0) {
          await Promise.race([
            Promise.allSettled(orderPushes),
            new Promise((resolve) => setTimeout(resolve, 3000)),
          ]);
        }

        // Auto-assign unassigned delivery orders when they become READY
        if (isDelivery && status === "READY" && !fullOrder.deliveryDriver?.id && restaurantId) {
          useCases.orders.assignDelivery(restaurantId, orderId).catch((err) =>
            console.error("Delivery auto-assign on READY failed:", err)
          );
        }
      }
    }

    return NextResponse.json(order);
  } catch (err) {
    if (err instanceof StaleStatusTransitionError) {
      // Order has moved on (or is gone) since the caller decided to
      // PATCH. Examples: a kitchen tablet's queued "READY" arriving
      // after the floor manager cancelled the order, or a SERVED
      // double-tap on an already-PAID order. 409 = "your view of
      // this resource is stale, refresh and retry."
      return NextResponse.json(
        { error: "STALE_TRANSITION", message: "This order's status has already moved." },
        { status: 409 }
      );
    }
    console.error("Order status update failed:", err);
    return NextResponse.json(
      { error: "Failed to update order status" },
      { status: 500 }
    );
  }
}
