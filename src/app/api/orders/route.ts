import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createOrder, getOrdersForRestaurant, getDefaultRestaurant, getTableByNumber, getRestaurantBySlug } from "@/lib/queries";
import { autoAssignDelivery } from "@/lib/delivery-assignment";

// Resolve restaurantId — could be a slug or a cuid
async function resolveRestaurantId(id: string): Promise<string | null> {
  if (!id) return null;
  if (id.startsWith("c") && id.length > 10) return id;
  const restaurant = await getRestaurantBySlug(id);
  return restaurant?.id || null;
}

// ─── POST: Create order ──────────────────────────

export async function POST(request: NextRequest) {
  const body = await request.json();

  try {
    const rawRestaurantId = body.restaurantId;
    if (!rawRestaurantId) {
      return NextResponse.json(
        { error: "restaurantId is required" },
        { status: 400 }
      );
    }

    // Resolve restaurant: accept slug or cuid
    const restaurantId = await resolveRestaurantId(rawRestaurantId);
    if (!restaurantId) {
      return NextResponse.json(
        { error: "Restaurant not found" },
        { status: 400 }
      );
    }

    // Resolve table: accept either a real tableId (cuid) or a table number string.
    // VIP orders (VIP_DINE_IN / DELIVERY) may have no tableId at all.
    let tableId = body.tableId || null;
    if (tableId && !tableId.startsWith("c")) {
      const tableNum = parseInt(tableId.replace(/\D/g, ""), 10) || 1;
      const table = await getTableByNumber(restaurantId, tableNum);
      if (!table) {
        return NextResponse.json(
          { error: `Table ${tableNum} not found` },
          { status: 400 }
        );
      }
      tableId = table.id;
    }

    // Validate session is still open before accepting order
    if (body.sessionId) {
      const session = await db.tableSession.findUnique({
        where: { id: body.sessionId },
        select: { status: true },
      });
      if (session?.status === "CLOSED") {
        return NextResponse.json(
          { error: "SESSION_CLOSED", message: "This session has been closed. Please scan the QR code to start a new session." },
          { status: 409 }
        );
      }
    }

    // Reject unavailable menu items — prevents stale-tab orders
    const itemIds = body.items.map((i: { menuItemId: string }) => i.menuItemId);
    const availableItems = await db.menuItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, name: true, available: true },
    });
    const unavailable = availableItems.filter((i) => !i.available);
    if (unavailable.length > 0) {
      return NextResponse.json(
        { error: "ITEMS_UNAVAILABLE", items: unavailable.map((i) => i.name) },
        { status: 409 }
      );
    }

    const order = await createOrder({
      restaurantId,
      tableId,
      sessionId: body.sessionId || undefined,
      items: body.items,
      subtotal: body.subtotal,
      total: body.total,
      tip: body.tip || 0,
      paymentMethod: body.paymentMethod,
      language: body.language,
      notes: body.notes,
      guestNumber: typeof body.guestNumber === "number" ? body.guestNumber : undefined,
      clientRequestId: typeof body.clientRequestId === "string" ? body.clientRequestId : undefined,
      orderType: body.orderType,
      vipGuestId: body.vipGuestId,
      deliveryAddress: body.deliveryAddress,
      deliveryLat: body.deliveryLat,
      deliveryLng: body.deliveryLng,
      deliveryNotes: body.deliveryNotes,
    });

    // Auto-assign delivery order to an online driver
    if (body.orderType === "DELIVERY") {
      // Use the first sub-order's id (or the main order id) for assignment
      const deliveryOrderId = Array.isArray(order) ? order[0]?.id : order.id;
      if (deliveryOrderId) {
        autoAssignDelivery(restaurantId, deliveryOrderId).catch((err) =>
          console.error("Delivery auto-assign failed:", err)
        );
      }
    }

    return NextResponse.json(order, { status: 201 });
  } catch (err) {
    console.error("Order creation failed:", err);
    return NextResponse.json(
      { error: "Failed to create order" },
      { status: 500 }
    );
  }
}

// ─── GET: List orders ────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const rawId = url.searchParams.get("restaurantId");
    let restaurantId: string | null = null;

    if (rawId) {
      restaurantId = await resolveRestaurantId(rawId);
    }
    if (!restaurantId) {
      const restaurant = await getDefaultRestaurant();
      restaurantId = restaurant?.id ?? null;
    }

    if (!restaurantId) {
      return NextResponse.json(
        { error: "restaurantId is required" },
        { status: 400 }
      );
    }

    const sessionIdFilter = url.searchParams.get("sessionId");
    if (sessionIdFilter) {
      // Return all orders for a specific session
      const sessionOrders = await db.order.findMany({
        where: { restaurantId, sessionId: sessionIdFilter },
        include: { items: { include: { menuItem: { select: { name: true, image: true } } } } },
        orderBy: { createdAt: "asc" },
      });
      return NextResponse.json({ orders: sessionOrders });
    }

    const orders = await getOrdersForRestaurant(restaurantId);
    return NextResponse.json(orders);
  } catch (err) {
    console.error("Order list failed:", err);
    return NextResponse.json(
      { error: "Failed to list orders" },
      { status: 500 }
    );
  }
}
