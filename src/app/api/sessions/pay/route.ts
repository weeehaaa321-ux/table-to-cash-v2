import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";
import { maybeCloseSession } from "@/lib/queries";
import { requireStaffAuth } from "@/lib/api-auth";
import { notifyPaymentConfirmation } from "@/lib/payment-notify";

// PATCH (confirm-and-PAID) is the actual revenue gate — only the
// cashier should be able to close out money. POST (guest sends a pay
// request) and DELETE (guest cancels their own request) stay open;
// neither writes paidAt, and the existing paidAt guard on DELETE
// prevents anything that's already been confirmed from being unwound.
const PAY_CONFIRM_ROLES = ["CASHIER", "OWNER", "FLOOR_MANAGER"];

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { sessionId, paymentMethod } = body;

  if (!sessionId || !paymentMethod) {
    return NextResponse.json({ error: "sessionId and paymentMethod required" }, { status: 400 });
  }

  try {
    const session = await useCases.sessions.findForPayRequest(sessionId);
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (session.status === "CLOSED") {
      return NextResponse.json({ error: "Session is already closed" }, { status: 409 });
    }

    await useCases.sessions.stampPendingPaymentMethod(sessionId, paymentMethod);

    const total = await useCases.sessions.sumOpenTotal(sessionId);
    const label =
      paymentMethod === "CASH"
        ? "Cash Payment Incoming"
        : paymentMethod === "CARD"
          ? "Card Payment Incoming"
          : "Payment Incoming";
    const tableLabel = session.table ? `Table ${session.table.number}` : "VIP";

    // Targeted push: on-shift cashiers always get pinged (they're the
    // assigned ones). If none of them is currently clocked in, the
    // helper also escalates to the OWNER and FLOOR_MANAGER so the
    // payment doesn't sit waiting until somebody happens to walk by.
    await notifyPaymentConfirmation({
      restaurantId: session.restaurant.id,
      title: label,
      body: `${tableLabel} — ${total} EGP (${paymentMethod})`,
      tagBase: `pay-${sessionId}`,
    }).catch(() => {});

    return NextResponse.json({ success: true, pending: true });
  } catch (err) {
    console.error("Session payment failed:", err);
    return NextResponse.json({ error: "Payment failed" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { sessionId } = body as { sessionId?: string };

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  try {
    const result = await useCases.sessions.cancelPaymentRequest(sessionId);
    if (!result.ok) {
      return NextResponse.json(
        { error: "PAYMENT_CONFIRMED", message: "Cashier has already confirmed payment — cannot cancel." },
        { status: 409 }
      );
    }
    return NextResponse.json({ success: true, cleared: result.cleared });
  } catch (err) {
    console.error("Payment cancel failed:", err);
    return NextResponse.json({ error: "Cancel failed" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { sessionId, paymentMethod, tip } = body as {
    sessionId?: string;
    paymentMethod?: string;
    tip?: number;
  };

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const authed = await requireStaffAuth(request, PAY_CONFIRM_ROLES);
  if (authed instanceof NextResponse) return authed;

  const sessionScope = await useCases.sessions.getSessionRestaurantScope(sessionId);
  if (!sessionScope || sessionScope.restaurantId !== authed.restaurantId) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Cashier-entered tip for this round. Whole-EGP rounded server-side.
  const tipAmount = typeof tip === "number" && tip > 0 && isFinite(tip)
    ? Math.round(tip)
    : 0;

  try {
    const result = await useCases.sessions.confirmPayRound({
      sessionId,
      paymentMethod: paymentMethod || "CASH",
      tipAmount,
    });

    if (result.noop) {
      return NextResponse.json({ success: true, paidOrders: 0, sessionClosed: false, confirmedTotal: 0 });
    }

    await maybeCloseSession(sessionId);
    const anyUnpaid = await useCases.sessions.countOpenUnpaid(sessionId);
    const sessionInfo = await useCases.sessions.findTableNumber(sessionId);

    return NextResponse.json({
      success: true,
      paidOrders: result.orders.length,
      sessionClosed: anyUnpaid === 0,
      confirmedTotal: result.confirmedTotal,
      tableNumber: sessionInfo?.table?.number ?? null,
    });
  } catch (err) {
    console.error("Payment confirmation failed:", err);
    return NextResponse.json({ error: "Confirmation failed" }, { status: 500 });
  }
}
