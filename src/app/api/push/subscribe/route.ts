import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { endpoint, p256dh, auth, staffId, role, restaurantId: rawRestaurantId, lang } = body;
    if (!endpoint || !p256dh || !auth || !rawRestaurantId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // The client sends a restaurant SLUG (e.g. "neom-dahab"), but
    // PushSubscription.restaurantId is a foreign key into Restaurant.id
    // (a CUID). Without this resolve step, the upsert fails with a
    // P2003 foreign-key violation and Prisma turns it into a 500. That
    // was the root cause of "0 subscriptions ever registered" — every
    // device that tried to subscribe got a generic Subscribe failed
    // and bailed.
    const restaurantId = await useCases.sessions.resolveRestaurantId(rawRestaurantId);
    if (!restaurantId) {
      return NextResponse.json(
        { error: "Restaurant not found", detail: `No restaurant with id or slug "${rawRestaurantId}".` },
        { status: 400 },
      );
    }

    await useCases.pushSubs.subscribe({
      endpoint,
      p256dh,
      auth,
      staffId: staffId || null,
      role: role || null,
      restaurantId,
      lang: lang === "ar" ? "ar" : "en",
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    // Surface the actual error so the client diagnostic alert can
    // show it. Without this the route used to return a generic
    // "Subscribe failed" with no detail.
    const message = (err as Error)?.message || String(err);
    console.error("Push subscribe failed:", err);
    return NextResponse.json(
      { error: "Subscribe failed", detail: message.slice(0, 300) },
      { status: 500 },
    );
  }
}
