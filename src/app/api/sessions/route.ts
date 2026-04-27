import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";

async function autoAssignWaiter(restaurantId: string): Promise<string | null> {
  const realId = await useCases.sessions.resolveRestaurantId(restaurantId);
  if (!realId) return null;

  const currentShift = useCases.sessions.currentShift();

  const waiters = await useCases.sessions.listActiveWaiters(realId, currentShift);
  if (waiters.length === 0) return null;

  const sessionCounts = await useCases.sessions.openSessionCountsByWaiter(realId);
  const counts = new Map<string, number>();
  for (const w of waiters) counts.set(w.id, 0);
  for (const sc of sessionCounts) {
    if (sc.waiterId) counts.set(sc.waiterId, sc._count);
  }

  let minCount = Infinity;
  for (const [, count] of counts) if (count < minCount) minCount = count;
  const candidates = waiters.filter((w) => (counts.get(w.id) || 0) === minCount);

  const lastSession = await useCases.sessions.lastSessionWithWaiter(realId);
  if (lastSession?.waiterId) {
    const lastIdx = candidates.findIndex((w) => w.id === lastSession.waiterId);
    if (lastIdx >= 0 && lastIdx < candidates.length - 1) {
      return candidates[lastIdx + 1].id;
    }
  }
  return candidates[0]?.id || null;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const sessionIdParam = url.searchParams.get("sessionId");
  const tableNumber = parseInt(url.searchParams.get("tableNumber") || "0", 10);
  const restaurantId = url.searchParams.get("restaurantId") || "";

  if (sessionIdParam) {
    try {
      const session = await useCases.sessions.findById(sessionIdParam);
      return NextResponse.json({
        session: session || null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tableNumber: (session as any)?.table?.number ?? null,
      });
    } catch (err) {
      console.error("Session lookup by ID failed:", err);
      return NextResponse.json({ error: "Failed to find session" }, { status: 500 });
    }
  }

  const vipGuestId = url.searchParams.get("vipGuestId");
  if (vipGuestId && restaurantId) {
    try {
      const realId = await useCases.sessions.resolveRestaurantId(restaurantId);
      if (!realId) return NextResponse.json({ session: null });
      const session = await useCases.sessions.findOpenForVip(vipGuestId, realId);
      return NextResponse.json({ session: session || null });
    } catch (err) {
      console.error("VIP session lookup failed:", err);
      return NextResponse.json({ error: "Failed to find session" }, { status: 500 });
    }
  }

  if (!tableNumber || !restaurantId) {
    return NextResponse.json({ error: "tableNumber and restaurantId required" }, { status: 400 });
  }

  try {
    const realId = await useCases.sessions.resolveRestaurantId(restaurantId);
    if (!realId) return NextResponse.json({ session: null });
    const session = await useCases.sessions.findOpenForTable(tableNumber, realId);
    return NextResponse.json({ session: session || null });
  } catch (err) {
    console.error("Session lookup failed:", err);
    return NextResponse.json({ error: "Failed to find session" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { tableNumber, restaurantId, guestCount: bodyGuestCount, waiterId: bodyWaiterId, orderType, vipGuestId } = body;

  const isVip = orderType === "VIP_DINE_IN" || orderType === "DELIVERY";

  if (!isVip && (!tableNumber || !restaurantId)) {
    return NextResponse.json({ error: "tableNumber and restaurantId required" }, { status: 400 });
  }
  if (isVip && !restaurantId) {
    return NextResponse.json({ error: "restaurantId required" }, { status: 400 });
  }

  const waiterId = isVip
    ? (orderType === "VIP_DINE_IN" ? (bodyWaiterId || await autoAssignWaiter(restaurantId)) : null)
    : (bodyWaiterId || await autoAssignWaiter(restaurantId));
  const guestCount = orderType === "DELIVERY" ? 0 : (bodyGuestCount || 1);

  try {
    const realId = await useCases.sessions.resolveRestaurantId(restaurantId);
    if (!realId) {
      return NextResponse.json({ error: "Restaurant not found" }, { status: 400 });
    }

    if (isVip) {
      if (vipGuestId) {
        const existing = await useCases.sessions.findOpenVipByOrderType(vipGuestId, realId, orderType);
        if (existing) return NextResponse.json(existing, { status: 200 });
      }
      const session = await useCases.sessions.createVipSession({
        restaurantId: realId,
        guestCount,
        waiterId,
        orderType,
        vipGuestId: vipGuestId || null,
      });
      return NextResponse.json(session, { status: 201 });
    }

    const table = await useCases.sessions.findTableByNumber(realId, parseInt(tableNumber));
    if (!table) {
      return NextResponse.json({ error: `Table ${tableNumber} not found` }, { status: 400 });
    }

    const session = await useCases.sessions.createTableSession({
      tableId: table.id,
      restaurantId: realId,
      guestCount,
      waiterId,
    });
    return NextResponse.json(session, { status: 201 });
  } catch (err) {
    console.error("Session creation failed:", err);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { sessionId, action } = body;
  if (!sessionId || !action) {
    return NextResponse.json({ error: "sessionId and action required" }, { status: 400 });
  }

  try {
    if (action === "close") {
      const meta = await useCases.sessions.getMeta(sessionId);
      const isVipSession = meta?.orderType === "VIP_DINE_IN" || meta?.orderType === "DELIVERY";

      const { session, cancelledCount } = await useCases.sessions.closeWithCancellations({
        sessionId,
        isVipSession,
      });

      if (session.waiterId) {
        try {
          const { sendPushToStaff } = await import("@/lib/web-push");
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const s = session as any;
          const label = s.table ? `Table ${s.table.number}` : (s.vipGuest ? `VIP: ${s.vipGuest.name}` : "VIP session");
          await sendPushToStaff(session.waiterId, {
            title: isVipSession ? "VIP Session Closed" : "Table Cleared",
            body: `${label} was closed by the manager.${cancelledCount > 0 ? ` ${cancelledCount} order(s) cancelled.` : ""}`,
          });
        } catch {}
      }
      return NextResponse.json({ ...session, cancelledOrders: cancelledCount });
    }

    if (action === "increment_guests") {
      const meta = await useCases.sessions.getMeta(sessionId);
      if (meta?.orderType === "DELIVERY") {
        return NextResponse.json({ error: "Delivery sessions have no guest count" }, { status: 400 });
      }
      const session = await useCases.sessions.incrementGuestCount(sessionId);
      return NextResponse.json(session);
    }

    if (action === "assign_waiter" && body.waiterId) {
      const session = await useCases.sessions.assignWaiter(sessionId, body.waiterId);
      try {
        const { sendPushToStaff } = await import("@/lib/web-push");
        await sendPushToStaff(body.waiterId, {
          title: "Table Assigned",
          body: `You've been assigned to ${session.table ? `Table ${session.table.number}` : "a VIP session"}`,
          tag: `assign-${sessionId}`,
          url: "/waiter",
        });
      } catch { /* push not critical */ }
      return NextResponse.json(session);
    }

    if (action === "change_table" && body.newTableNumber) {
      const newTableNumber = parseInt(body.newTableNumber, 10);
      const result = await useCases.sessions.changeTable(sessionId, newTableNumber);
      if ("error" in result) {
        if (result.error === "Session not found") return NextResponse.json(result, { status: 404 });
        if (result.error === "DELIVERY_NO_TABLE") return NextResponse.json({ error: "Delivery sessions cannot change table" }, { status: 400 });
        if (result.error === "Table not found") return NextResponse.json(result, { status: 404 });
        return NextResponse.json({ error: "Table is occupied" }, { status: 409 });
      }
      const { currentSession, oldTableNumber } = result;
      if (currentSession.waiterId) {
        try {
          const { sendPushToStaff } = await import("@/lib/web-push");
          await sendPushToStaff(currentSession.waiterId, {
            title: "Table Moved",
            body: `Table ${oldTableNumber} → Table ${newTableNumber} — same session, serve the new table`,
            tag: `table-move-${sessionId}`,
            url: "/waiter",
          });
        } catch { /* push not critical */ }
      }
      try {
        const { sendPushToRole } = await import("@/lib/web-push");
        await sendPushToRole("KITCHEN", currentSession.restaurantId, {
          title: "Table Moved",
          body: `Table ${oldTableNumber} → Table ${newTableNumber} — deliver orders to new table`,
          tag: `table-move-kitchen-${sessionId}`,
          url: "/kitchen",
        });
      } catch { /* push not critical */ }
      return NextResponse.json({ ...result.session, oldTableNumber, newTableNumber });
    }

    if (action === "menu_opened") {
      const session = await useCases.sessions.setMenuOpened(sessionId);
      return NextResponse.json(session);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("Session update failed:", err);
    return NextResponse.json({ error: "Failed to update session" }, { status: 500 });
  }
}
