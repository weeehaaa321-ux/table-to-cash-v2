import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";
import { nowInRestaurantTz } from "@/lib/restaurant-config";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const driverId = url.searchParams.get("driverId");
  const orderId = url.searchParams.get("orderId");
  const rawId = url.searchParams.get("restaurantId") || "";

  const restaurantId = await useCases.delivery.resolveRestaurantId(rawId);
  if (!restaurantId) {
    return NextResponse.json({ error: "restaurantId required" }, { status: 400 });
  }

  if (orderId) {
    const order = await useCases.delivery.findOrderForTracking(orderId, restaurantId);
    if (!order) return NextResponse.json([]);
    return NextResponse.json([{
      id: order.id,
      deliveryStatus: order.deliveryStatus,
      deliveryDriverName: order.deliveryDriver?.name ?? null,
      pickedUpAt: order.pickedUpAt?.toISOString() ?? null,
      deliveredAt: order.deliveredAt?.toISOString() ?? null,
    }]);
  }

  const cairoNow = nowInRestaurantTz();
  const todayStart = new Date(cairoNow.getFullYear(), cairoNow.getMonth(), cairoNow.getDate());
  const offset = new Date().getTime() - cairoNow.getTime();
  const todayStartUTC = new Date(todayStart.getTime() + offset);

  const orders = await useCases.delivery.listForBoard({
    restaurantId,
    driverId,
    todayStartUTC,
  });

  return NextResponse.json(orders.map((o) => ({
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    total: o.total,
    notes: o.notes,
    deliveryAddress: o.deliveryAddress || o.vipGuest?.address || null,
    deliveryNotes: o.deliveryNotes || o.vipGuest?.addressNotes || null,
    deliveryLat: o.deliveryLat || o.vipGuest?.locationLat || null,
    deliveryLng: o.deliveryLng || o.vipGuest?.locationLng || null,
    deliveryStatus: o.deliveryStatus,
    deliveryDriverId: o.deliveryDriverId,
    deliveryDriverName: o.deliveryDriver?.name ?? null,
    vipGuestName: o.vipGuest?.name ?? null,
    vipGuestPhone: o.vipGuest?.phone ?? null,
    pickedUpAt: o.pickedUpAt?.toISOString() ?? null,
    deliveredAt: o.deliveredAt?.toISOString() ?? null,
    readyAt: o.readyAt?.toISOString() ?? null,
    items: o.items.map((i) => ({
      name: i.menuItem?.name ?? "Deleted item",
      quantity: i.quantity,
      price: i.price,
    })),
    paymentMethod: o.paymentMethod ?? null,
    createdAt: o.createdAt.toISOString(),
  })));
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { orderId, driverId } = body;

  if (!orderId || !driverId) {
    return NextResponse.json({ error: "orderId and driverId required" }, { status: 400 });
  }

  try {
    const order = await useCases.delivery.claimOrder(orderId, driverId);
    if (!order) {
      return NextResponse.json({ error: "Order already claimed by another driver" }, { status: 409 });
    }

    try {
      const { sendPushToStaff } = await import("@/lib/web-push");
      await sendPushToStaff(driverId, {
        title: "New Delivery Assigned",
        body: `Order #${order.orderNumber} — pick up from kitchen`,
        tag: `delivery-${orderId}`,
        url: "/delivery",
      });
    } catch {}

    return NextResponse.json(order);
  } catch (err) {
    console.error("Delivery assignment failed:", err);
    return NextResponse.json({ error: "Failed to assign delivery" }, { status: 500 });
  }
}
