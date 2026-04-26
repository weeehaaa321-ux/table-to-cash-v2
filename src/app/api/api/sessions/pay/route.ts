import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sendPushToStaff } from "@/lib/web-push";
import { maybeCloseSession } from "@/lib/queries";
import { requireStaffAuth } from "@/lib/api-auth";
import { toNum } from "@/lib/money";

// PATCH (confirm-and-PAID) is the actual revenue gate — only the
// cashier should be able to close out money. POST (guest sends a pay
// request) and DELETE (guest cancels their own request) stay open;
// neither writes paidAt, and the existing paidAt guard on DELETE
// prevents anything that's already been confirmed from being unwound.
const PAY_CONFIRM_ROLES = ["CASHIER", "OWNER", "FLOOR_MANAGER"];

// POST: Guest requests payment for their session.
// Records the guest's chosen method on every open order but leaves paidAt
// null and status unchanged — the cashier is the single source of truth
// for marking a session actually paid. All methods (CASH / CARD / INSTAPAY)
// flow through the cashier confirmation step.
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { sessionId, paymentMethod } = body;

  if (!sessionId || !paymentMethod) {
    return NextResponse.json({ error: "sessionId and paymentMethod required" }, { status: 400 });
  }

  try {
    const session = await db.tableSession.findUnique({
      where: { id: sessionId },
      include: { table: { select: { number: true } }, restaurant: { select: { id: true } } },
    });
    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    if (session.status === "CLOSED") {
      return NextResponse.json({ error: "Session is already closed" }, { status: 409 });
    }

    // paidAt: null scopes this to the current unpaid round only. Without
    // it, a round-2 pay request would overwrite the paymentMethod stamped
    // on a round-1 order that was already settled by the cashier but is
    // still cooking (status not yet PAID), mangling reconciliation.
    await db.order.updateMany({
      where: { sessionId, status: { notIn: ["PAID", "CANCELLED"] }, paidAt: null },
      data: { paymentMethod },
    });

    // Notify every active cashier — they need to confirm receipt.
    if (session) {
      const total = await db.order.aggregate({
        where: { sessionId, status: { notIn: ["PAID", "CANCELLED"] } },
        _sum: { total: true },
      });
      const cashiers = await db.staff.findMany({
        where: { restaurantId: session.restaurant.id, role: "CASHIER", active: true },
        select: { id: true },
      });
      const label =
        paymentMethod === "CASH"
          ? "Cash Payment Incoming"
          : paymentMethod === "CARD"
            ? "Card Payment Incoming"
            : "Payment Incoming";
      for (const cashier of cashiers) {
        sendPushToStaff(cashier.id, {
          title: label,
          body: `${session.table ? `Table ${session.table.number}` : "VIP"} — ${toNum(total._sum.total)} EGP (${paymentMethod})`,
          tag: `pay-${sessionId}`,
          url: "/cashier",
        }).catch(() => {});
      }
    }

    return NextResponse.json({ success: true, pending: true });
  } catch (err) {
    console.error("Session payment failed:", err);
    return NextResponse.json({ error: "Payment failed" }, { status: 500 });
  }
}

// DELETE: Guest cancels their own pending payment request.
// Clears paymentMethod on every order in the session — but ONLY while no
// order has a paidAt stamp. The paidAt guard is the safety net: once the
// cashier has confirmed anything, this endpoint becomes a no-op so a real
// payment can never be unwound by this path.
export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { sessionId } = body as { sessionId?: string };

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  try {
    const confirmed = await db.order.count({
      where: { sessionId, paidAt: { not: null } },
    });
    if (confirmed > 0) {
      return NextResponse.json(
        { error: "PAYMENT_CONFIRMED", message: "Cashier has already confirmed payment — cannot cancel." },
        { status: 409 }
      );
    }

    const result = await db.order.updateMany({
      where: { sessionId, paidAt: null, paymentMethod: { not: null } },
      data: { paymentMethod: null },
    });

    return NextResponse.json({ success: true, cleared: result.count });
  } catch (err) {
    console.error("Payment cancel failed:", err);
    return NextResponse.json({ error: "Cancel failed" }, { status: 500 });
  }
}

// PATCH: Confirm payment — marks orders as PAID and closes session
// Used by cashier (with paymentMethod) or as a generic confirm
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

  // Restaurant scope — cashier in restaurant A must not be able to
  // confirm payment on a session in restaurant B by knowing the cuid.
  const sessionScope = await db.tableSession.findUnique({
    where: { id: sessionId },
    select: { restaurantId: true },
  });
  if (!sessionScope || sessionScope.restaurantId !== authed.restaurantId) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  // Cashier-entered tip for this round. We stamp the whole amount onto
  // the first settled order — aggregating by sum(Order.tip) then gives
  // the correct total whether a session paid in one round or five. We
  // don't split across orders because fractional tip attribution has no
  // real-world meaning and just creates floating-point drift. Round at
  // write time so the stored EGP is always a whole-currency value.
  const tipAmount = typeof tip === "number" && tip > 0 && isFinite(tip)
    ? Math.round(tip)
    : 0;

  try {
    // Wrap the entire confirmation in a transaction so two cashiers
    // can't double-settle the same orders. The read + write must be
    // atomic: without this, cashier A reads 3 unpaid orders, cashier B
    // reads the same 3, and both stamp paidAt — doubling the reported
    // confirmedTotal and confusing reconciliation.
    const result = await db.$transaction(async (tx) => {
      // Normal flow: settle only orders the guest pre-requested payment
      // for, so a new order placed between the guest's request and the
      // cashier's confirm tap rolls into the next round.
      //
      // Cashier override: if NO order has a paymentMethod yet (guest
      // walked up without tapping pay on their phone), settle every open
      // non-cancelled, unpaid order.
      let orders = await tx.order.findMany({
        where: {
          sessionId,
          status: { notIn: ["PAID", "CANCELLED"] },
          paidAt: null,
          paymentMethod: { not: null },
        },
        select: { id: true, status: true, total: true },
      });
      if (orders.length === 0) {
        orders = await tx.order.findMany({
          where: {
            sessionId,
            status: { notIn: ["PAID", "CANCELLED"] },
            paidAt: null,
          },
          select: { id: true, status: true, total: true },
        });
      }

      if (orders.length === 0) {
        return { orders: [], confirmedTotal: 0, noop: true };
      }

      // Cashier confirmed payment. SERVED orders flip to PAID immediately;
      // orders still in the kitchen keep their status but get paymentMethod
      // stamped so the guest can still track them.
      const now = new Date();
      const method = (paymentMethod || "CASH") as "CASH" | "CARD" | "INSTAPAY" | "APPLE_PAY" | "GOOGLE_PAY";
      // Attach full tip to the first order in the round. Later rounds on
      // the same session can add their own tip via a subsequent PATCH and
      // it lands on that round's first order.
      const tipTargetId = orders[0]?.id;
      for (const order of orders) {
        const applyTip = order.id === tipTargetId && tipAmount > 0;
        if (order.status === "SERVED") {
          await tx.order.update({
            where: { id: order.id },
            data: {
              status: "PAID",
              paymentMethod: method,
              paidAt: now,
              ...(applyTip ? { tip: { increment: tipAmount } } : {}),
            },
          });
        } else {
          await tx.order.update({
            where: { id: order.id },
            data: {
              paymentMethod: method,
              paidAt: now,
              ...(applyTip ? { tip: { increment: tipAmount } } : {}),
            },
          });
        }
      }

      const confirmedTotal = orders.reduce((sum, o) => sum + toNum(o.total), 0);
      return { orders, confirmedTotal, noop: false, method };
    });

    if (result.noop) {
      return NextResponse.json({ success: true, paidOrders: 0, sessionClosed: false, confirmedTotal: 0 });
    }

    // Side effects run outside the transaction — they're non-critical
    // and shouldn't hold the DB lock.
    await maybeCloseSession(sessionId);
    const anyUnpaid = await db.order.count({
      where: { sessionId, status: { notIn: ["PAID", "CANCELLED"] } },
    });

    const sessionInfo = await db.tableSession.findUnique({
      where: { id: sessionId },
      select: { table: { select: { number: true } } },
    });

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
