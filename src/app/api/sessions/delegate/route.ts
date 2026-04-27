import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { sessionId, guestNumber } = body;
  if (!sessionId || !guestNumber) {
    return NextResponse.json({ error: "sessionId and guestNumber required" }, { status: 400 });
  }
  try {
    const session = await useCases.sessions.getRestaurantOfSession(sessionId);
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    await useCases.sessions.clearPaymentDelegations(sessionId);
    await useCases.sessions.addPaymentDelegation(sessionId, session.restaurantId, guestNumber);
    return NextResponse.json({ success: true, paymentDelegate: guestNumber });
  } catch (err) {
    console.error("Delegation failed:", err);
    return NextResponse.json({ error: "Failed to delegate" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  try {
    const delegation = await useCases.sessions.getPaymentDelegation(sessionId);
    return NextResponse.json({
      paymentDelegate: delegation ? parseInt(delegation.command || "0", 10) : null,
    });
  } catch {
    return NextResponse.json({ paymentDelegate: null });
  }
}
