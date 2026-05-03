import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";

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

  if (requestId) {
    const req = await useCases.sessions.findJoinRequestById(requestId);
    if (!req) return NextResponse.json({ status: "expired" });
    return NextResponse.json({ id: req.id, status: req.status.toLowerCase() });
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
