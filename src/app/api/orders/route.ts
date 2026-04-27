import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";

export async function POST(request: NextRequest) {
  const body = await request.json();
  try {
    if (!body.restaurantId) {
      return NextResponse.json({ error: "restaurantId is required" }, { status: 400 });
    }
    const restaurantId = await useCases.orders.resolveRestaurantId(body.restaurantId);
    if (!restaurantId) {
      return NextResponse.json({ error: "Restaurant not found" }, { status: 400 });
    }

    let tableId = body.tableId || null;
    if (tableId && !tableId.startsWith("c")) {
      const tableNum = parseInt(tableId.replace(/\D/g, ""), 10) || 1;
      const table = await useCases.orders.findTableInRestaurant(restaurantId, tableNum);
      if (!table) {
        return NextResponse.json({ error: `Table ${tableNum} not found` }, { status: 400 });
      }
      tableId = table.id;
    }

    if (body.sessionId) {
      const session = await useCases.orders.getSessionStatus(body.sessionId);
      if (session?.status === "CLOSED") {
        return NextResponse.json(
          { error: "SESSION_CLOSED", message: "This session has been closed. Please scan the QR code to start a new session." },
          { status: 409 },
        );
      }
    }

    const itemIds = body.items.map((i: { menuItemId: string }) => i.menuItemId);
    const unavailable = await useCases.orders.findUnavailableMenuItems(itemIds);
    if (unavailable.length > 0) {
      return NextResponse.json(
        { error: "ITEMS_UNAVAILABLE", items: unavailable.map((i) => i.name) },
        { status: 409 },
      );
    }

    const order = await useCases.orders.create({
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

    if (body.orderType === "DELIVERY") {
      const deliveryOrderId = Array.isArray(order) ? order[0]?.id : order.id;
      if (deliveryOrderId) {
        useCases.orders.assignDelivery(restaurantId, deliveryOrderId).catch((err) =>
          console.error("Delivery auto-assign failed:", err),
        );
      }
    }

    return NextResponse.json(order, { status: 201 });
  } catch (err) {
    console.error("Order creation failed:", err);
    return NextResponse.json({ error: "Failed to create order" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const rawId = url.searchParams.get("restaurantId");
    let restaurantId: string | null = null;
    if (rawId) restaurantId = await useCases.orders.resolveRestaurantId(rawId);
    if (!restaurantId) {
      const r = await useCases.orders.defaultRestaurant();
      restaurantId = r?.id ?? null;
    }
    if (!restaurantId) {
      return NextResponse.json({ error: "restaurantId is required" }, { status: 400 });
    }

    const sessionIdFilter = url.searchParams.get("sessionId");
    if (sessionIdFilter) {
      const sessionOrders = await useCases.orders.sessionOrdersWithItems(restaurantId, sessionIdFilter);
      return NextResponse.json({ orders: sessionOrders });
    }

    const orders = await useCases.orders.listForRestaurant(restaurantId);
    return NextResponse.json(orders);
  } catch (err) {
    console.error("Order list failed:", err);
    return NextResponse.json({ error: "Failed to list orders" }, { status: 500 });
  }
}
