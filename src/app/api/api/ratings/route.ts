import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

async function resolveRestaurantId(id: string): Promise<string | null> {
  if (!id) return null;
  if (id.startsWith("c") && id.length > 10) return id;
  const restaurant = await db.restaurant.findUnique({
    where: { slug: id },
    select: { id: true },
  });
  return restaurant?.id || null;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sessionId, restaurantId: rawId, food, service, hygiene, comment } = body;

    if (!sessionId || !rawId) {
      return NextResponse.json({ error: "sessionId and restaurantId required" }, { status: 400 });
    }

    const restaurantId = await resolveRestaurantId(rawId);
    if (!restaurantId) {
      return NextResponse.json({ error: "Restaurant not found" }, { status: 400 });
    }

    // Upsert — one rating per session
    const rating = await db.rating.upsert({
      where: { sessionId },
      create: {
        sessionId,
        restaurantId,
        food: food || 0,
        service: service || 0,
        hygiene: hygiene || 0,
        comment: comment || null,
      },
      update: {
        food: food || 0,
        service: service || 0,
        hygiene: hygiene || 0,
        comment: comment || null,
      },
    });

    return NextResponse.json(rating, { status: 201 });
  } catch (err) {
    console.error("Rating save failed:", err);
    return NextResponse.json({ error: "Failed to save rating" }, { status: 500 });
  }
}
