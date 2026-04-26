import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { endpoint, p256dh, auth, staffId, role, restaurantId } = body;
    if (!endpoint || !p256dh || !auth || !restaurantId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    await useCases.pushSubs.subscribe({
      endpoint, p256dh, auth, staffId: staffId || null, role: role || null, restaurantId,
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    console.error("Push subscribe failed:", err);
    return NextResponse.json({ error: "Subscribe failed" }, { status: 500 });
  }
}
