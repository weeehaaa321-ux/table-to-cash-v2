import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentShift } from "@/lib/shifts";

// Resolve restaurantId — could be a slug or a cuid
async function resolveRestaurantId(id: string): Promise<string | null> {
  if (!id) return null;
  // If it looks like a cuid, use directly
  if (id.startsWith("c") && id.length > 10) return id;
  // Otherwise treat as slug
  const restaurant = await db.restaurant.findUnique({
    where: { slug: id },
    select: { id: true },
  });
  return restaurant?.id || null;
}

// ─── Auto-assign waiter (least active sessions, round-robin tiebreak) ────
async function autoAssignWaiter(restaurantId: string): Promise<string | null> {
  const realId = await resolveRestaurantId(restaurantId);
  if (!realId) return null;

  const currentShift = getCurrentShift();

  // Only waiters whose assigned shift matches the current time AND are
  // clocked in (active). No bypass for shift=0 (unassigned) and no
  // fallback to off-shift waiters — if nobody qualifies the table goes
  // unassigned and an on-shift waiter can pick it up manually.
  const waiters = await db.staff.findMany({
    where: { restaurantId: realId, role: "WAITER", active: true, shift: currentShift },
    orderBy: { createdAt: "asc" },
  });
  if (waiters.length === 0) return null;

  // Count open sessions per waiter
  const sessionCounts = await db.tableSession.groupBy({
    by: ["waiterId"],
    where: { restaurantId: realId, status: "OPEN", waiterId: { not: null } },
    _count: true,
  });
  const counts = new Map<string, number>();
  for (const w of waiters) counts.set(w.id, 0);
  for (const sc of sessionCounts) {
    if (sc.waiterId) counts.set(sc.waiterId, sc._count);
  }

  let minCount = Infinity;
  for (const [, count] of counts) {
    if (count < minCount) minCount = count;
  }

  const candidates = waiters.filter((w) => (counts.get(w.id) || 0) === minCount);

  // Round-robin: find last assigned (ANY session, not just open — so rotation persists after sessions close)
  const lastSession = await db.tableSession.findFirst({
    where: { restaurantId: realId, waiterId: { not: null } },
    orderBy: { openedAt: "desc" },
    select: { waiterId: true },
  });

  if (lastSession?.waiterId) {
    const lastIdx = candidates.findIndex((w) => w.id === lastSession.waiterId);
    if (lastIdx >= 0 && lastIdx < candidates.length - 1) {
      return candidates[lastIdx + 1].id;
    }
    // lastIdx === last element or not found among candidates — wrap to first
  }
  return candidates[0]?.id || null;
}

// ─── GET: Find open session for a table ─────────

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const sessionIdParam = url.searchParams.get("sessionId");
  const tableNumber = parseInt(url.searchParams.get("tableNumber") || "0", 10);
  const restaurantId = url.searchParams.get("restaurantId") || "";

  // ─── Lookup by sessionId (preferred — survives table moves) ───
  if (sessionIdParam) {
    try {
      const session = await db.tableSession.findUnique({
        where: { id: sessionIdParam },
        include: {
          table: { select: { number: true } },
          orders: {
            where: { status: { notIn: ["PAID", "CANCELLED"] } },
            include: {
              items: { include: { menuItem: { select: { name: true, image: true } } } },
            },
            orderBy: { createdAt: "desc" },
          },
          waiter: { select: { id: true, name: true } },
        },
      });
      return NextResponse.json({
        session: session || null,
        tableNumber: session?.table?.number ?? null,
      });
    } catch (err) {
      console.error("Session lookup by ID failed:", err);
      return NextResponse.json({ error: "Failed to find session" }, { status: 500 });
    }
  }

  // ─── VIP lookup by vipGuestId ───
  const vipGuestId = url.searchParams.get("vipGuestId");
  if (vipGuestId && restaurantId) {
    try {
      const realId = await resolveRestaurantId(restaurantId);
      if (!realId) return NextResponse.json({ session: null });
      const session = await db.tableSession.findFirst({
        where: { vipGuestId, restaurantId: realId, status: "OPEN" },
        include: {
          orders: {
            where: { status: { notIn: ["PAID", "CANCELLED"] } },
            include: { items: { include: { menuItem: { select: { name: true, image: true } } } } },
            orderBy: { createdAt: "desc" },
          },
          waiter: { select: { id: true, name: true } },
          vipGuest: { select: { name: true } },
        },
      });
      return NextResponse.json({ session: session || null });
    } catch (err) {
      console.error("VIP session lookup failed:", err);
      return NextResponse.json({ error: "Failed to find session" }, { status: 500 });
    }
  }

  // ─── Fallback: lookup by tableNumber ───
  if (!tableNumber || !restaurantId) {
    return NextResponse.json({ error: "tableNumber and restaurantId required" }, { status: 400 });
  }

  try {
    const realId = await resolveRestaurantId(restaurantId);
    if (!realId) {
      return NextResponse.json({ session: null });
    }

    // Find table by number
    const table = await db.table.findUnique({
      where: { restaurantId_number: { restaurantId: realId, number: tableNumber } },
    });
    if (!table) {
      return NextResponse.json({ session: null });
    }

    const session = await db.tableSession.findFirst({
      where: { tableId: table.id, restaurantId: realId, status: "OPEN" },
      include: {
        orders: {
          where: { status: { notIn: ["PAID", "CANCELLED"] } },
          include: {
            items: {
              include: { menuItem: { select: { name: true, image: true } } },
            },
          },
          orderBy: { createdAt: "desc" },
        },
        waiter: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ session: session || null });
  } catch (err) {
    console.error("Session lookup failed:", err);
    return NextResponse.json({ error: "Failed to find session" }, { status: 500 });
  }
}

// ─── POST: Create new session ───────────────────

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

  // VIP dine-in gets a waiter; delivery does not
  const waiterId = isVip
    ? (orderType === "VIP_DINE_IN" ? (bodyWaiterId || await autoAssignWaiter(restaurantId)) : null)
    : (bodyWaiterId || await autoAssignWaiter(restaurantId));
  const guestCount = orderType === "DELIVERY" ? 0 : (bodyGuestCount || 1);

  try {
    const realId = await resolveRestaurantId(restaurantId);
    if (!realId) {
      return NextResponse.json({ error: "Restaurant not found" }, { status: 400 });
    }

    if (isVip) {
      // Reuse existing OPEN session for this VIP guest + order type
      if (vipGuestId) {
        const existing = await db.tableSession.findFirst({
          where: { restaurantId: realId, vipGuestId, orderType: orderType as never, status: "OPEN" },
          include: {
            waiter: { select: { id: true, name: true } },
            vipGuest: { select: { name: true } },
          },
        });
        if (existing) {
          return NextResponse.json(existing, { status: 200 });
        }
      }

      // VIP session — no table required
      const session = await db.tableSession.create({
        data: {
          restaurantId: realId,
          guestType: "vip",
          guestCount,
          waiterId,
          orderType: orderType as never,
          vipGuestId: vipGuestId || null,
        },
        include: {
          waiter: { select: { id: true, name: true } },
          vipGuest: { select: { name: true } },
        },
      });


      return NextResponse.json(session, { status: 201 });
    }

    // Regular table session
    const table = await db.table.findUnique({
      where: { restaurantId_number: { restaurantId: realId, number: parseInt(tableNumber) } },
    });
    if (!table) {
      return NextResponse.json({ error: `Table ${tableNumber} not found` }, { status: 400 });
    }

    // Close any existing open session and create the new one in a
    // transaction to prevent duplicate sessions on the same table.
    const session = await db.$transaction(async (tx) => {
      await tx.tableSession.updateMany({
        where: { tableId: table.id, restaurantId: realId, status: "OPEN" },
        data: { status: "CLOSED", closedAt: new Date() },
      });

      return tx.tableSession.create({
        data: {
          tableId: table.id,
          restaurantId: realId,
          guestType: "walkin",
          guestCount,
          waiterId,
        },
        include: {
          waiter: { select: { id: true, name: true } },
        },
      });
    });

    return NextResponse.json(session, { status: 201 });
  } catch (err) {
    console.error("Session creation failed:", err);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}

// ─── PATCH: Update session (close, increment guests, assign waiter) ────

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { sessionId, action } = body;

  if (!sessionId || !action) {
    return NextResponse.json({ error: "sessionId and action required" }, { status: 400 });
  }

  try {
    if (action === "close") {
      // Check if this is a VIP session
      const sessionInfo = await db.tableSession.findUnique({
        where: { id: sessionId },
        select: { orderType: true, vipGuestId: true },
      });
      const isVipSession = sessionInfo?.orderType === "VIP_DINE_IN" || sessionInfo?.orderType === "DELIVERY";

      let cancelledCount = 0;

      if (isVipSession) {
        // VIP close: only cancel PENDING orders (not yet started).
        // Orders already being prepared/ready continue through the pipeline.
        const pendingOrders = await db.order.findMany({
          where: { sessionId, status: "PENDING" },
          select: { id: true },
        });
        if (pendingOrders.length > 0) {
          await db.order.updateMany({
            where: { id: { in: pendingOrders.map((o) => o.id) } },
            data: { status: "CANCELLED" },
          });
          await db.orderItem.updateMany({
            where: { orderId: { in: pendingOrders.map((o) => o.id) }, cancelled: false },
            data: { cancelled: true, cancelReason: "VIP session closed", cancelledAt: new Date() },
          });
          for (const o of pendingOrders) {

          }
          cancelledCount = pendingOrders.length;
        }
      } else {
        // Table close: cancel ALL non-paid orders (kitchen stops working)
        const unpaidOrders = await db.order.findMany({
          where: { sessionId, status: { notIn: ["PAID", "CANCELLED"] } },
          select: { id: true, status: true },
        });
        if (unpaidOrders.length > 0) {
          await db.order.updateMany({
            where: { id: { in: unpaidOrders.map((o) => o.id) } },
            data: { status: "CANCELLED" },
          });
          await db.orderItem.updateMany({
            where: { orderId: { in: unpaidOrders.map((o) => o.id) }, cancelled: false },
            data: { cancelled: true, cancelReason: "Session closed by manager", cancelledAt: new Date() },
          });
          for (const o of unpaidOrders) {

          }
          cancelledCount = unpaidOrders.length;
        }
      }

      const session = await db.tableSession.update({
        where: { id: sessionId },
        data: { status: "CLOSED", closedAt: new Date() },
        include: { table: { select: { number: true } }, waiter: { select: { id: true, name: true } }, vipGuest: { select: { name: true } } },
      });

      if (session.waiterId) {
        try {
          const { sendPushToStaff } = await import("@/lib/web-push");
          const label = session.table ? `Table ${session.table.number}` : (session.vipGuest ? `VIP: ${session.vipGuest.name}` : "VIP session");
          await sendPushToStaff(session.waiterId, {
            title: isVipSession ? "VIP Session Closed" : "Table Cleared",
            body: `${label} was closed by the manager.${cancelledCount > 0 ? ` ${cancelledCount} order(s) cancelled.` : ""}`,
          });
        } catch {}
      }

      return NextResponse.json({ ...session, cancelledOrders: cancelledCount });
    }

    if (action === "increment_guests") {
      const sess = await db.tableSession.findUnique({ where: { id: sessionId }, select: { orderType: true } });
      if (sess?.orderType === "DELIVERY") {
        return NextResponse.json({ error: "Delivery sessions have no guest count" }, { status: 400 });
      }
      const session = await db.tableSession.update({
        where: { id: sessionId },
        data: { guestCount: { increment: 1 } },
      });
      return NextResponse.json(session);
    }

    if (action === "assign_waiter" && body.waiterId) {
      const session = await db.tableSession.update({
        where: { id: sessionId },
        data: { waiterId: body.waiterId },
        include: { table: { select: { number: true } } },
      });
      // Send push notification to the assigned waiter
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
      // Find the current session with waiter info — block for delivery
      const currentSession = await db.tableSession.findUnique({
        where: { id: sessionId },
        include: {
          table: { select: { number: true } },
          waiter: { select: { id: true, name: true } },
        },
      });
      if (!currentSession) {
        return NextResponse.json({ error: "Session not found" }, { status: 404 });
      }
      if (currentSession.orderType === "DELIVERY") {
        return NextResponse.json({ error: "Delivery sessions cannot change table" }, { status: 400 });
      }
      const oldTableNumber = currentSession.table?.number ?? 0;

      // Find the new table
      const newTable = await db.table.findUnique({
        where: { restaurantId_number: { restaurantId: currentSession.restaurantId, number: newTableNumber } },
      });
      if (!newTable) {
        return NextResponse.json({ error: "Table not found" }, { status: 404 });
      }

      // Check no open session on the new table
      const existing = await db.tableSession.findFirst({
        where: { tableId: newTable.id, status: "OPEN" },
      });
      if (existing) {
        return NextResponse.json({ error: "Table is occupied" }, { status: 409 });
      }

      // Move session to the new table (waiter assignment stays the same)
      const updated = await db.tableSession.update({
        where: { id: sessionId },
        data: { tableId: newTable.id },
      });

      // Move ALL orders in this session to the new table
      await db.order.updateMany({
        where: { sessionId },
        data: { tableId: newTable.id },
      });

      // Notify assigned waiter about the table move
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

      // Notify kitchen about the table move
      try {
        const { sendPushToRole } = await import("@/lib/web-push");
        await sendPushToRole("KITCHEN", currentSession.restaurantId, {
          title: "Table Moved",
          body: `Table ${oldTableNumber} → Table ${newTableNumber} — deliver orders to new table`,
          tag: `table-move-kitchen-${sessionId}`,
          url: "/kitchen",
        });
      } catch { /* push not critical */ }

      return NextResponse.json({ ...updated, oldTableNumber, newTableNumber });
    }

    if (action === "menu_opened") {
      const session = await db.tableSession.update({
        where: { id: sessionId },
        data: { menuOpenedAt: new Date() },
      });
      return NextResponse.json(session);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("Session update failed:", err);
    return NextResponse.json({ error: "Failed to update session" }, { status: 500 });
  }
}
