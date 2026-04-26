import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const staffId = url.searchParams.get("staffId");
  if (!staffId) return NextResponse.json({ error: "staffId required" }, { status: 400 });
  const staff = await useCases.delivery.getDriverStatus(staffId);
  return NextResponse.json({ online: staff?.deliveryOnline ?? false });
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { staffId, online } = body;
  if (!staffId || typeof online !== "boolean") {
    return NextResponse.json({ error: "staffId and online (boolean) are required" }, { status: 400 });
  }
  const staff = await useCases.delivery.getDriverStatus(staffId);
  if (!staff || staff.role !== "DELIVERY") {
    return NextResponse.json({ error: "Staff not found or not a delivery driver" }, { status: 404 });
  }
  await useCases.delivery.setDriverOnline(staffId, online);
  if (online) {
    useCases.delivery.assignPending(staff.restaurantId).catch((err) =>
      console.error("Failed to assign pending deliveries:", err),
    );
  }
  return NextResponse.json({ ok: true, online });
}
