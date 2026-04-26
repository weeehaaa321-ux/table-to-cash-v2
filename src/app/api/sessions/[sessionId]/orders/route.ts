import { NextRequest, NextResponse } from "next/server";
import { getOrdersForSession } from "@/lib/queries";

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/sessions/[sessionId]/orders">
) {
  const { sessionId } = await ctx.params;

  try {
    const orders = await getOrdersForSession(sessionId);
    return NextResponse.json(orders);
  } catch (err) {
    console.error("Session orders fetch failed:", err);
    return NextResponse.json({ error: "Failed to fetch session orders" }, { status: 500 });
  }
}
