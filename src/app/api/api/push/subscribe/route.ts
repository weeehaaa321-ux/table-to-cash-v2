import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const { endpoint, p256dh, auth, staffId, role, restaurantId } = await request.json();

    if (!endpoint || !p256dh || !auth || !restaurantId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Resolve restaurant
    let realId = restaurantId;
    if (!restaurantId.startsWith("c") || restaurantId.length <= 10) {
      const r = await db.restaurant.findUnique({ where: { slug: restaurantId }, select: { id: true } });
      realId = r?.id || restaurantId;
    }

    // Upsert by endpoint (one subscription per browser)
    await db.pushSubscription.upsert({
      where: { endpoint },
      create: { endpoint, p256dh, auth, staffId: staffId || null, role: role || null, restaurantId: realId },
      update: { p256dh, auth, staffId: staffId || null, role: role || null, updatedAt: new Date() },
    });

    // Clean up: if a staffId is provided, remove any OTHER subscriptions for this staff
    // (stale entries from old browsers/endpoints that no longer work)
    if (staffId) {
      await db.pushSubscription.deleteMany({
        where: { staffId, endpoint: { not: endpoint } },
      });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Push subscribe failed:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
