import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";

export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/orders/[orderId]">
) {
  const { orderId } = await ctx.params;

  if (!orderId) {
    return NextResponse.json({ error: "orderId required" }, { status: 400 });
  }

  try {
    const order = await useCases.orders.findById(orderId);
    if (!order) {
      return NextResponse.json(null);
    }

    return NextResponse.json({
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      tableNumber: order.table?.number ?? null,
      items: order.items,
      subtotal: order.subtotal,
      total: order.total,
      createdAt: order.createdAt.toISOString(),
    });
  } catch (err) {
    console.error("Failed to fetch order:", err);
    return NextResponse.json({ error: "Failed to fetch order" }, { status: 500 });
  }
}
