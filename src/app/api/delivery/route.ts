import { NextRequest, NextResponse } from "next/server";
import { legacyDb as db } from "@/infrastructure/composition";
import { nowInRestaurantTz } from "@/lib/restaurant-config";

async function resolveRestaurantId(id: string): Promise<string | null> {
  if (!id) return null;
  if (id.startsWith("c") && id.length > 10) return id;
  const r = await db.restaurant.findUnique({ where: { slug: id }, select: { id: true } });
  return r?.id || null;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const driverId = url.searchParams.get("driverId");
  const orderId = url.searchParams.get("orderId");
  const rawId = url.searchParams.get("restaurantId") || "";

  const restaurantId = await resolveRestaurantId(rawId);
  if (!restaurantId) {
    return NextResponse.json({ error: "restaurantId required" }, { status: 400 });
  }

  // Single-order lookup (used by VIP tracking page)
  if (orderId) {
    const order = await db.order.findFirst({
      where: { id: orderId, restaurantId, orderType: "DELIVERY" },
      include: {
        deliveryDriver: { select: { id: true, name: true } },
      },
    });
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

  const orders = await db.order.findMany({
    where: {
      restaurantId,
      orderType: "DELIVERY",
      AND: [
        // Time scope: active orders OR delivered today
        {
          OR: [
            { status: { notIn: ["PAID", "CANCELLED"] } },
            { deliveredAt: { gte: todayStartUTC } },
          ],
        },
        // Driver scope: show their orders + unassigned orders from CONFIRMED onward
        // (drivers see orders early so they can head to restaurant while kitchen prepares)
        ...(driverId ? [{
          OR: [
            { deliveryDriverId: driverId },
            { deliveryDriverId: null, status: { notIn: ["PENDING", "CANCELLED", "PAID"] as never } },
          ],
        }] : []),
        // Owner view: same logic — show assigned + unassigned from CONFIRMED onward
        ...(!driverId ? [{
          OR: [
            { deliveryDriverId: { not: null } },
            { deliveryDriverId: null, status: { notIn: ["PENDING", "CANCELLED", "PAID"] as never } },
            { deliveredAt: { gte: todayStartUTC } },
          ],
        }] : []),
      ],
    },
    include: {
      items: { include: { menuItem: { select: { name: true } } } },
      vipGuest: { select: { name: true, phone: true, address: true, addressNotes: true, locationLat: true, locationLng: true } },
      deliveryDriver: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
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
    // Atomic claim: only assign if no driver yet AND kitchen has confirmed
    const updated = await db.order.updateMany({
      where: { id: orderId, deliveryDriverId: null, status: { notIn: ["PENDING", "CANCELLED", "PAID"] as never } },
      data: {
        deliveryDriverId: driverId,
        deliveryStatus: "ASSIGNED",
      },
    });
    if (updated.count === 0) {
      return NextResponse.json({ error: "Order already claimed by another driver" }, { status: 409 });
    }
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { id: true, orderNumber: true, deliveryStatus: true },
    });

    try {
      const { sendPushToStaff } = await import("@/lib/web-push");
      await sendPushToStaff(driverId, {
        title: "New Delivery Assigned",
        body: `Order #${order?.orderNumber} — pick up from kitchen`,
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
