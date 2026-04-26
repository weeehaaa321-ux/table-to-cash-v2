import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { assignPendingDeliveries } from "@/lib/delivery-assignment";

// GET: Check if a specific driver is currently online
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const staffId = url.searchParams.get("staffId");

  if (!staffId) {
    return NextResponse.json({ error: "staffId required" }, { status: 400 });
  }

  const staff = await db.staff.findUnique({
    where: { id: staffId },
    select: { deliveryOnline: true },
  });

  return NextResponse.json({ online: staff?.deliveryOnline ?? false });
}

// PATCH: Toggle delivery driver online/offline status
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { staffId, online } = body;

  if (!staffId || typeof online !== "boolean") {
    return NextResponse.json(
      { error: "staffId and online (boolean) are required" },
      { status: 400 }
    );
  }

  const staff = await db.staff.findUnique({
    where: { id: staffId },
    select: { id: true, role: true, restaurantId: true },
  });

  if (!staff || staff.role !== "DELIVERY") {
    return NextResponse.json(
      { error: "Staff not found or not a delivery driver" },
      { status: 404 }
    );
  }

  await db.staff.update({
    where: { id: staffId },
    data: { deliveryOnline: online },
  });

  // When going online, try to assign any pending unassigned delivery orders
  if (online) {
    assignPendingDeliveries(staff.restaurantId).catch((err) =>
      console.error("Failed to assign pending deliveries:", err)
    );
  }

  return NextResponse.json({ ok: true, online });
}
