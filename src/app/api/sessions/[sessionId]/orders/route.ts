import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/sessions/[sessionId]/orders">,
) {
  const { sessionId } = await ctx.params;
  try {
    const orders = await useCases.orders.listForSession(sessionId);
    return NextResponse.json(orders);
  } catch (err) {
    console.error("Session orders fetch failed:", err);
    return NextResponse.json({ error: "Failed to fetch session orders" }, { status: 500 });
  }
}
