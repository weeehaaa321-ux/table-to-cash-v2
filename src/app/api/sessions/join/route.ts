import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";
import { requireStaffAuth } from "@/lib/api-auth";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { sessionId, guestId } = body;
  if (!sessionId || !guestId) {
    return NextResponse.json({ error: "sessionId and guestId required" }, { status: 400 });
  }
  // Atomic claim-or-join. If the session has no client owner yet
  // (waiter pre-seated the table), this guest is auto-promoted to
  // owner — otherwise a PENDING request is created for the existing
  // owner to approve. Returning guests with a prior PENDING/APPROVED
  // record get that record echoed back so they walk back into the
  // same role.
  const result = await useCases.sessions.claimOrJoinSession(sessionId, guestId);
  return NextResponse.json(
    { id: result.id, status: result.status, role: result.role },
    { status: result.status === "pending" ? 201 : 200 },
  );
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const requestId = url.searchParams.get("requestId");
  const sessionId = url.searchParams.get("sessionId");
  const restaurantParam = url.searchParams.get("restaurantId");
  const scope = url.searchParams.get("scope");

  if (requestId) {
    const req = await useCases.sessions.findJoinRequestById(requestId);
    if (!req) return NextResponse.json({ status: "expired" });
    return NextResponse.json({ id: req.id, status: req.status.toLowerCase() });
  }
  // Floor-manager / owner sweep: every pending join request across
  // the restaurant. Lets the floor view show a "stuck at gate" panel
  // for guests waiting on an absent session owner.
  if (scope === "all" && restaurantParam) {
    const authed = await requireStaffAuth(request, ["OWNER", "FLOOR_MANAGER"]);
    if (authed instanceof NextResponse) return authed;
    const realId = await useCases.sessions.resolveRestaurantId(restaurantParam);
    if (!realId || realId !== authed.restaurantId) {
      return NextResponse.json({ requests: [] });
    }
    const pending = await useCases.sessions.listPendingJoinRequestsForRestaurant(realId);
    return NextResponse.json({
      requests: pending.map((r) => ({
        id: r.id,
        guestId: r.guestId,
        sessionId: r.sessionId,
        createdAt: r.createdAt.toISOString(),
        tableNumber: r.session?.table?.number ?? null,
        vipGuestName: r.session?.vipGuest?.name ?? null,
        orderType: r.session?.orderType ?? "TABLE",
        guestCount: r.session?.guestCount ?? 0,
      })),
    });
  }
  if (sessionId) {
    const pending = await useCases.sessions.listPendingJoinRequests(sessionId);
    return NextResponse.json({
      requests: pending.map((r) => ({ id: r.id, guestId: r.guestId })),
    });
  }
  return NextResponse.json({ error: "requestId or sessionId required" }, { status: 400 });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { requestId, action } = body;
  if (!requestId || !["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "requestId and action (approve/reject) required" }, { status: 400 });
  }
  const req = await useCases.sessions.findJoinRequestById(requestId);
  if (!req) return NextResponse.json({ error: "Request not found or expired" }, { status: 404 });
  const newStatus = action === "approve" ? "APPROVED" : "REJECTED";
  await useCases.sessions.setJoinRequestStatus(requestId, newStatus);
  if (newStatus === "APPROVED") {
    try {
      await useCases.sessions.incrementGuestCount(req.sessionId);
    } catch { /* non-critical */ }
  }
  return NextResponse.json({ id: req.id, status: newStatus.toLowerCase() });
}
