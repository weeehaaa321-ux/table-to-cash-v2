import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";
import { requireStaffAuth } from "@/lib/api-auth";

// POST: Cashier reverses the most-recent paid round on a session.
// Older rounds stay settled. Re-opens the session if it had been
// auto-closed by the settlement; writes an audit Message.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { sessionId, reason } = body as {
    sessionId?: string;
    reason?: string;
  };

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const authed = await requireStaffAuth(request, ["CASHIER", "OWNER", "FLOOR_MANAGER"]);
  if (authed instanceof NextResponse) return authed;

  const staff = await useCases.staffManagement.findActorIdentity(authed.id);
  if (!staff) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sessionScope = await useCases.sessions.getSessionRestaurantScope(sessionId);
  if (!sessionScope || sessionScope.restaurantId !== staff.restaurantId) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  try {
    const result = await useCases.sessions.reverseLatestPayRound({
      sessionId,
      actor: staff,
      reason,
    });

    if (result.noop) {
      return NextResponse.json({
        success: true,
        message: "No paid rounds to reverse",
        reversed: 0,
      });
    }

    return NextResponse.json({ success: true, ...result });
  } catch (err) {
    console.error("Payment reverse failed:", err);
    return NextResponse.json({ error: "Reverse failed" }, { status: 500 });
  }
}
