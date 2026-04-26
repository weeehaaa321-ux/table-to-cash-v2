import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// POST: Create a join request (guest wants to join a session)
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { sessionId, guestId } = body;

  if (!sessionId || !guestId) {
    return NextResponse.json({ error: "sessionId and guestId required" }, { status: 400 });
  }

  // Check for existing pending request from this guest
  const existing = await db.joinRequest.findFirst({
    where: { sessionId, guestId, status: "PENDING" },
  });
  if (existing) {
    return NextResponse.json({ id: existing.id, status: existing.status.toLowerCase() });
  }

  const req = await db.joinRequest.create({
    data: { sessionId, guestId },
  });

  return NextResponse.json({ id: req.id, status: "pending" }, { status: 201 });
}

// GET: Check join request status or get pending requests for a session
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const requestId = url.searchParams.get("requestId");
  const sessionId = url.searchParams.get("sessionId");

  if (requestId) {
    const req = await db.joinRequest.findUnique({ where: { id: requestId } });
    if (!req) return NextResponse.json({ status: "expired" });
    return NextResponse.json({ id: req.id, status: req.status.toLowerCase() });
  }

  if (sessionId) {
    const pending = await db.joinRequest.findMany({
      where: { sessionId, status: "PENDING" },
      orderBy: { createdAt: "asc" },
    });
    return NextResponse.json({
      requests: pending.map((r) => ({ id: r.id, guestId: r.guestId })),
    });
  }

  return NextResponse.json({ error: "requestId or sessionId required" }, { status: 400 });
}

// PATCH: Approve or reject a join request (by session owner guest)
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { requestId, action } = body;

  if (!requestId || !["approve", "reject"].includes(action)) {
    return NextResponse.json({ error: "requestId and action (approve/reject) required" }, { status: 400 });
  }

  const req = await db.joinRequest.findUnique({ where: { id: requestId } });
  if (!req) {
    return NextResponse.json({ error: "Request not found or expired" }, { status: 404 });
  }

  const newStatus = action === "approve" ? "APPROVED" : "REJECTED";
  await db.joinRequest.update({
    where: { id: requestId },
    data: { status: newStatus as "APPROVED" | "REJECTED" },
  });

  // If approved, increment guest count
  if (newStatus === "APPROVED") {
    try {
      await db.tableSession.update({
        where: { id: req.sessionId },
        data: { guestCount: { increment: 1 } },
      });
    } catch { /* non-critical */ }
  }

  return NextResponse.json({ id: req.id, status: newStatus.toLowerCase() });
}
