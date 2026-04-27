import { NextRequest, NextResponse } from "next/server";
import { legacyDb as db } from "@/infrastructure/composition";

// POST: Delegate payment authority to another guest number (called by guest)
// Body: { sessionId, guestNumber }
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { sessionId, guestNumber } = body;

  if (!sessionId || !guestNumber) {
    return NextResponse.json({ error: "sessionId and guestNumber required" }, { status: 400 });
  }

  try {
    const session = await db.tableSession.findUnique({
      where: { id: sessionId },
      select: { restaurantId: true },
    });
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Remove any previous delegation for this session
    await db.message.deleteMany({
      where: { type: "payment_delegate", to: sessionId },
    });

    // Create new delegation record
    await db.message.create({
      data: {
        type: "payment_delegate",
        from: "owner",
        to: sessionId,
        command: String(guestNumber),
        restaurantId: session.restaurantId,
      },
    });

    return NextResponse.json({ success: true, paymentDelegate: guestNumber });
  } catch (err) {
    console.error("Delegation failed:", err);
    return NextResponse.json({ error: "Failed to delegate" }, { status: 500 });
  }
}

// GET: Check who has payment authority for a session
// ?sessionId=X
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  try {
    const delegation = await db.message.findFirst({
      where: { type: "payment_delegate", to: sessionId },
      orderBy: { createdAt: "desc" },
      select: { command: true },
    });

    return NextResponse.json({
      paymentDelegate: delegation ? parseInt(delegation.command || "0", 10) : null,
    });
  } catch {
    return NextResponse.json({ paymentDelegate: null });
  }
}
