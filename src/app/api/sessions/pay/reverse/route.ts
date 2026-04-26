import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaffAuth } from "@/lib/api-auth";
import { toNum } from "@/lib/money";

// POST: Cashier reverses a confirmed payment on a session.
// Only the MOST RECENT paid round is reversed — older rounds stay
// settled so multi-round bills don't collapse. After reversal:
//   - Affected orders: paidAt = null, paymentMethod = null,
//     status reverts from PAID → SERVED (non-PAID rows just drop the
//     paymentMethod/paidAt stamp, their status was never flipped).
//   - Session re-opens if it was CLOSED by the settlement.
//
// Body: { sessionId, reason? }
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { sessionId, reason } = body as {
    sessionId?: string;
    reason?: string;
  };

  if (!sessionId) {
    return NextResponse.json(
      { error: "sessionId required" },
      { status: 400 }
    );
  }

  // Reversal is the blast-radius action — wipes paidAt + reopens the
  // session. Identity must come from the signed header, not the body.
  const authed = await requireStaffAuth(request, ["CASHIER", "OWNER", "FLOOR_MANAGER"]);
  if (authed instanceof NextResponse) return authed;

  const staff = await db.staff.findUnique({
    where: { id: authed.id },
    select: { id: true, name: true, restaurantId: true },
  });
  if (!staff) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Restaurant scope — same-tenant only.
  const sessionScope = await db.tableSession.findUnique({
    where: { id: sessionId },
    select: { restaurantId: true },
  });
  if (!sessionScope || sessionScope.restaurantId !== staff.restaurantId) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  try {
    const result = await db.$transaction(async (tx) => {
      // Identify the most recent settlement round. paidAt is stamped
      // atomically per round, so max(paidAt) scoped to this session is
      // the round we undo.
      const latest = await tx.order.findFirst({
        where: { sessionId, paidAt: { not: null } },
        orderBy: { paidAt: "desc" },
        select: { paidAt: true },
      });
      if (!latest?.paidAt) {
        return { reversed: 0, noop: true };
      }

      // Reverse everything stamped at that exact paidAt (within 1s
      // tolerance — the confirm loop stamps each order in the round
      // with the same `now`, but any per-row drift is within ms).
      const windowStart = new Date(latest.paidAt.getTime() - 1000);
      const windowEnd = new Date(latest.paidAt.getTime() + 1000);

      const affected = await tx.order.findMany({
        where: {
          sessionId,
          paidAt: { gte: windowStart, lte: windowEnd },
        },
        select: { id: true, status: true, total: true, paymentMethod: true },
      });

      for (const o of affected) {
        await tx.order.update({
          where: { id: o.id },
          data: {
            paidAt: null,
            paymentMethod: null,
            // If we'd marked it PAID, walk it back to SERVED so the
            // waiter's "clear table" flow still sees it as delivered.
            // Kitchen-in-progress rows (CONFIRMED/PREPARING/READY) keep
            // their status — only the payment stamp was wrong.
            status: o.status === "PAID" ? "SERVED" : o.status,
          },
        });
      }

      // Re-open the session if this reversal means it's no longer fully
      // paid. If there are still older paid rounds covering everything,
      // leave it closed.
      const session = await tx.tableSession.findUnique({
        where: { id: sessionId },
        select: { status: true },
      });
      let reopened = false;
      if (session?.status === "CLOSED") {
        await tx.tableSession.update({
          where: { id: sessionId },
          data: { status: "OPEN", closedAt: null },
        });
        reopened = true;
      }

      // Audit trail — use Message since we don't have a dedicated audit
      // log yet. type=command, command="payment_reversed:<sessionId>"
      // so it's queryable later without scanning all messages.
      const totalReversed = affected.reduce((s, o) => s + toNum(o.total), 0);
      await tx.message.create({
        data: {
          type: "command",
          from: staff.id,
          to: "owner",
          text: `${staff.name} reversed payment of ${Math.round(totalReversed)} EGP on session ${sessionId.slice(-8)}${reason ? ` — ${reason}` : ""}`,
          command: `payment_reversed:${sessionId}`,
          restaurantId: staff.restaurantId,
        },
      });

      return {
        reversed: affected.length,
        totalReversed,
        reopened,
        noop: false,
      };
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
