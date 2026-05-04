import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";
import { db } from "@/lib/db";

// Resolve the caller's role for the PATCH actions that need it. Returns
// either a role string (when a staff member is signed in via x-staff-id)
// or "guest" when the caller has provided a guestId in the body and
// holds an APPROVED JoinRequest on the session being mutated. Returns
// null when neither path validates — the route then 401s.
async function resolveCallerRole(
  request: NextRequest,
  sessionId: string,
  bodyGuestId?: string | null,
): Promise<{ kind: "staff"; role: string; staffId: string } | { kind: "guest" } | null> {
  const staffId = request.headers.get("x-staff-id");
  if (staffId) {
    const staff = await db.staff.findUnique({
      where: { id: staffId },
      select: { id: true, role: true, active: true },
    });
    if (!staff || !staff.active) return null;
    return { kind: "staff", role: staff.role, staffId: staff.id };
  }
  if (bodyGuestId && typeof bodyGuestId === "string") {
    const ok = await useCases.sessions.isSessionOwnerGuest(sessionId, bodyGuestId);
    if (ok) return { kind: "guest" };
  }
  return null;
}

async function autoAssignWaiter(restaurantId: string): Promise<string | null> {
  const realId = await useCases.sessions.resolveRestaurantId(restaurantId);
  if (!realId) return null;

  const currentShift = useCases.sessions.currentShift();

  // Eligible = scheduled for the current shift AND currently clocked in.
  // A waiter who's on the schedule but hasn't tapped the gate yet should
  // not have tables auto-pushed to them — they're not on the floor yet.
  const [shiftWaiters, openIds] = await Promise.all([
    useCases.sessions.listActiveWaiters(realId, currentShift),
    useCases.clockInOut.listOpenStaffIds(),
  ]);
  const openSet = new Set(openIds);
  const waiters = shiftWaiters.filter((w) => openSet.has(w.id));
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
  const { tableNumber, restaurantId, guestCount: bodyGuestCount, waiterId: bodyWaiterId, orderType, vipGuestId, guestId: bodyGuestId } = body;

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
      // When the caller is a guest browser (autoStart on /scan), it sends
      // its localStorage-persisted guestId so this server-side TX can
      // stamp them as the session owner atomically. Waiter "Seat" calls
      // omit guestId, leaving the seat open for the first scanner.
      ownerGuestId: typeof bodyGuestId === "string" && bodyGuestId.length > 0 ? bodyGuestId : null,
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
      // Manual assignment must match the same eligibility rules as
      // auto-assign: target must be clocked in AND scheduled for the
      // current shift (or shift=0). Otherwise the next reassign sweep
      // would just yank the table off them, and we'd be silently
      // overriding the floor manager's choice.
      const [openIds, target, currentShift] = await Promise.all([
        useCases.clockInOut.listOpenStaffIds(),
        useCases.staffManagement.findById(body.waiterId),
        Promise.resolve(useCases.sessions.currentShift()),
      ]);
      if (!openIds.includes(body.waiterId)) {
        return NextResponse.json(
          { error: "WAITER_NOT_CLOCKED_IN", message: "That waiter hasn't clocked in for this shift yet." },
          { status: 409 },
        );
      }
      if (!target || (target.shift !== 0 && target.shift !== currentShift)) {
        return NextResponse.json(
          { error: "WAITER_OFF_SHIFT", message: "That waiter isn't scheduled for the current shift." },
          { status: 409 },
        );
      }
      const session = await useCases.sessions.assignWaiter(sessionId, body.waiterId);
      try {
        const { sendPushToStaff } = await import("@/lib/web-push");
        const tableEn = session.table ? `Table ${session.table.number}` : "a VIP session";
        const tableAr = session.table ? `طاولة ${session.table.number}` : "جلسة VIP";
        await sendPushToStaff(body.waiterId, {
          title: { en: "Table Assigned", ar: "تم تعيين طاولة" },
          body: {
            en: `You've been assigned to ${tableEn}`,
            ar: `تم تعيينك لـ ${tableAr}`,
          },
          tag: `assign-${sessionId}`,
          url: "/waiter",
        });
      } catch { /* push not critical */ }
      return NextResponse.json(session);
    }

    if (action === "change_table" && body.newTableNumber) {
      // Auth: guest who owns the session, OR OWNER / FLOOR_MANAGER.
      // Waiters are explicitly NOT allowed to move tables — table
      // moves are a floor-level decision (group physically relocating)
      // and a waiter doing it silently can confuse the rest of the
      // floor's session-by-table mental model.
      const caller = await resolveCallerRole(request, sessionId, body.guestId);
      if (!caller) {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
      }
      if (caller.kind === "staff" && caller.role !== "OWNER" && caller.role !== "FLOOR_MANAGER") {
        return NextResponse.json(
          { error: "Only floor manager, owner, or the session's guest can move tables" },
          { status: 403 },
        );
      }
      const newTableNumber = parseInt(body.newTableNumber, 10);
      const result = await useCases.sessions.changeTable(sessionId, newTableNumber);
      if ("error" in result) {
        if (result.error === "Session not found") return NextResponse.json(result, { status: 404 });
        if (result.error === "DELIVERY_NO_TABLE") return NextResponse.json({ error: "Delivery sessions cannot change table" }, { status: 400 });
        if (result.error === "Table not found") return NextResponse.json(result, { status: 404 });
        return NextResponse.json({ error: "Table is occupied" }, { status: 409 });
      }
      const { currentSession, oldTableNumber } = result;
      const moveTitle = { en: "Table Moved", ar: "تم نقل الطاولة" };
      if (currentSession.waiterId) {
        try {
          const { sendPushToStaff } = await import("@/lib/web-push");
          await sendPushToStaff(currentSession.waiterId, {
            title: moveTitle,
            body: {
              en: `Table ${oldTableNumber} → Table ${newTableNumber} — same session, serve the new table`,
              ar: `طاولة ${oldTableNumber} → طاولة ${newTableNumber} — نفس الجلسة، اخدم الطاولة الجديدة`,
            },
            tag: `table-move-${sessionId}`,
            url: "/waiter",
          });
        } catch { /* push not critical */ }
      }
      try {
        const { sendPushToRole } = await import("@/lib/web-push");
        await sendPushToRole("KITCHEN", currentSession.restaurantId, {
          title: moveTitle,
          body: {
            en: `Table ${oldTableNumber} → Table ${newTableNumber} — deliver orders to new table`,
            ar: `طاولة ${oldTableNumber} → طاولة ${newTableNumber} — وصّل الطلبات للطاولة الجديدة`,
          },
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

    if (action === "move_guest") {
      // Floor-only action — only OWNER / FLOOR_MANAGER can move a guest
      // to a different table mid-session. Waiters and guests cannot
      // (the explicit guest self-move flow is "change_table" for the
      // entire group, not a single member).
      const caller = await resolveCallerRole(request, sessionId, null);
      if (!caller || caller.kind !== "staff") {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
      }
      if (caller.role !== "OWNER" && caller.role !== "FLOOR_MANAGER") {
        return NextResponse.json(
          { error: "Only floor manager or owner can move guests" },
          { status: 403 },
        );
      }
      const targetTableNumber = parseInt(body.targetTableNumber, 10);
      if (!targetTableNumber || Number.isNaN(targetTableNumber)) {
        return NextResponse.json({ error: "targetTableNumber required" }, { status: 400 });
      }
      const guestNumber =
        body.guestNumber != null && body.guestNumber !== ""
          ? parseInt(body.guestNumber, 10)
          : null;
      const guestName =
        typeof body.guestName === "string" && body.guestName.trim().length > 0
          ? body.guestName.trim()
          : null;
      if (guestNumber == null && !guestName) {
        return NextResponse.json(
          { error: "guestNumber or guestName required" },
          { status: 400 },
        );
      }
      const result = await useCases.sessions.moveGuestToTable({
        sessionId,
        guestNumber,
        guestName,
        targetTableNumber,
      });
      if ("error" in result) {
        if (result.error === "Session not found") return NextResponse.json(result, { status: 404 });
        if (result.error === "Target table not found") return NextResponse.json(result, { status: 404 });
        if (result.error === "Guest not found on source table") return NextResponse.json(result, { status: 404 });
        if (result.error === "Already at this table") return NextResponse.json(result, { status: 409 });
        if (result.error === "DELIVERY_NO_TABLE") return NextResponse.json({ error: "Delivery sessions cannot move guests" }, { status: 400 });
        if (result.error === "Missing guest identifier") return NextResponse.json(result, { status: 400 });
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
      // Notify both waiters + the kitchen so the new table assignment
      // reaches every screen without waiting for the next poll.
      try {
        const { sendPushToStaff, sendPushToRole } = await import("@/lib/web-push");
        const moveTitle = { en: "Guest moved", ar: "تم نقل ضيف" };
        const bodyMsg = {
          en: `${result.guestLabel}: Table ${result.sourceTableNumber} → Table ${result.targetTableNumber}`,
          ar: `${result.guestLabel}: طاولة ${result.sourceTableNumber} ← طاولة ${result.targetTableNumber}`,
        };
        if (result.sourceSession.waiterId) {
          await sendPushToStaff(result.sourceSession.waiterId, {
            title: moveTitle,
            body: bodyMsg,
            tag: `guest-move-${sessionId}`,
            url: "/waiter",
          });
        }
        if (result.targetSession.waiterId && result.targetSession.waiterId !== result.sourceSession.waiterId) {
          await sendPushToStaff(result.targetSession.waiterId, {
            title: moveTitle,
            body: bodyMsg,
            tag: `guest-move-${result.targetSession.id}`,
            url: "/waiter",
          });
        }
        await sendPushToRole("KITCHEN", result.sourceSession.restaurantId, {
          title: moveTitle,
          body: bodyMsg,
          tag: `guest-move-kitchen-${sessionId}`,
          url: "/kitchen",
        });
      } catch { /* push not critical */ }
      return NextResponse.json(result);
    }

    if (action === "merge_tables") {
      // Floor-only — folding two open sessions together is a
      // material change to revenue attribution and table state, so
      // only OWNER / FLOOR_MANAGER can do it.
      const caller = await resolveCallerRole(request, sessionId, null);
      if (!caller || caller.kind !== "staff") {
        return NextResponse.json({ error: "Authentication required" }, { status: 401 });
      }
      if (caller.role !== "OWNER" && caller.role !== "FLOOR_MANAGER") {
        return NextResponse.json(
          { error: "Only floor manager or owner can merge tables" },
          { status: 403 },
        );
      }
      const targetSessionId = typeof body.targetSessionId === "string" ? body.targetSessionId : "";
      if (!targetSessionId) {
        return NextResponse.json({ error: "targetSessionId required" }, { status: 400 });
      }
      // sessionId is the SOURCE (the one folded in / closed). target is
      // the survivor. The UI passes the picked-up session as source and
      // the destination as target.
      const result = await useCases.sessions.mergeTables(sessionId, targetSessionId);
      if ("error" in result) {
        if (result.error === "Source session not found") return NextResponse.json(result, { status: 404 });
        if (result.error === "Target session not found") return NextResponse.json(result, { status: 404 });
        if (result.error === "Cannot merge a session into itself") return NextResponse.json(result, { status: 400 });
        if (result.error === "Sessions belong to different restaurants") return NextResponse.json(result, { status: 400 });
        if (result.error === "Only TABLE sessions can be merged") return NextResponse.json(result, { status: 400 });
        if (result.error === "Target session has no table") return NextResponse.json(result, { status: 400 });
        return NextResponse.json({ error: result.error }, { status: 409 });
      }
      try {
        const { sendPushToStaff, sendPushToRole } = await import("@/lib/web-push");
        const title = { en: "Tables Merged", ar: "تم دمج الطاولات" };
        const bodyMsg = {
          en: `Table ${result.sourceTableNumber} folded into Table ${result.targetTableNumber} (+${result.mergedGuestCount} guest)`,
          ar: `طاولة ${result.sourceTableNumber} انضمت لطاولة ${result.targetTableNumber} (+${result.mergedGuestCount} ضيف)`,
        };
        if (result.target.waiterId) {
          await sendPushToStaff(result.target.waiterId, {
            title, body: bodyMsg, tag: `merge-${result.target.id}`, url: "/waiter",
          });
        }
        await sendPushToRole("KITCHEN", result.target.restaurantId, {
          title, body: bodyMsg, tag: `merge-kitchen-${result.target.id}`, url: "/kitchen",
        });
      } catch { /* push not critical */ }
      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("Session update failed:", err);
    return NextResponse.json({ error: "Failed to update session" }, { status: 500 });
  }
}
