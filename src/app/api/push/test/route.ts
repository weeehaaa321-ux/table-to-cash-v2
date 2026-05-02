import { NextRequest, NextResponse } from "next/server";
import { sendPushToStaff } from "@/lib/web-push";
import { db } from "@/lib/db";

// ─── Push self-test ──────────────────────────────────
//
// A staff member POSTs their staffId; the server sends a real web-push
// to their registered subscription. If their device doesn't buzz, the
// problem is identifiable:
//   • 404 / "no subscription" — they haven't subscribed yet
//   • 200 with success — push was attempted; if no buzz, the issue
//     is on the device (battery optimisation, notifications muted,
//     Chrome killed, iOS without PWA install)
//   • 500 — VAPID keys missing / wrong on the server
//
// POST /api/push/test
// body: { staffId: string }
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { staffId } = body as { staffId?: string };
  if (!staffId) {
    return NextResponse.json({ error: "staffId required" }, { status: 400 });
  }

  const subs = await db.pushSubscription.findMany({
    where: { staffId },
    select: { id: true },
  });
  if (subs.length === 0) {
    return NextResponse.json(
      { error: "no_subscription", message: "This device has not registered for push notifications. Open the waiter page and accept the notification prompt." },
      { status: 404 },
    );
  }

  try {
    await sendPushToStaff(staffId, {
      title: { en: "Test notification", ar: "إشعار تجريبي" },
      body: {
        en: "If you can see this on your lock screen, push is working.",
        ar: "إذا ظهر هذا الإشعار على شاشة القفل، فإن الإشعارات تعمل.",
      },
      tag: `test-push-${Date.now()}`,
      url: "/waiter",
    });
    return NextResponse.json({
      success: true,
      subscriptions: subs.length,
    });
  } catch (err) {
    console.error("Test push failed:", err);
    return NextResponse.json(
      { error: "push_failed", message: String((err as Error)?.message || err) },
      { status: 500 },
    );
  }
}
