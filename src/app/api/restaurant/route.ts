// Migrated to layered architecture. Behavior + response shapes byte-identical to source.

import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";

// Restaurant config rarely changes — name, logo, currency, capacity.
// Letting the browser/CDN serve it for 60s with SWR cuts thousands of
// duplicate hits per day from the role pages on first paint.
const SWR_CONFIG = {
  "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
} as const;

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const slug = url.searchParams.get("slug");

  try {
    const restaurant = await useCases.getCurrentRestaurant.bySlug(slug);
    if (!restaurant) {
      return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
    }
    return NextResponse.json(
      {
        id: restaurant.id,
        name: restaurant.name,
        slug: restaurant.slug,
        logo: restaurant.logo,
        currency: restaurant.currency,
        timezone: restaurant.timezone,
        waiterCapacity: restaurant.waiterCapacity,
        kitchenConfig: restaurant.kitchenConfig,
        instapayHandle: restaurant.instapayHandle ?? null,
        instapayPhone: restaurant.instapayPhone ?? null,
        createdAt: restaurant.createdAt,
      },
      { headers: SWR_CONFIG },
    );
  } catch (err) {
    console.error("Restaurant lookup failed:", err);
    return NextResponse.json({ error: "Failed to load restaurant" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { slug, waiterCapacity, instapayHandle, instapayPhone } = body;
    if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });
    if (waiterCapacity !== undefined) {
      await useCases.updateRestaurantConfig.setWaiterCapacity(Number(waiterCapacity));
    }
    // Accept handle / phone independently. Empty string clears the
    // value (so the dashboard can wipe a stale handle) while
    // undefined leaves it alone.
    if (instapayHandle !== undefined || instapayPhone !== undefined) {
      const normalize = (v: unknown): string | null | undefined =>
        v === undefined ? undefined
        : v === null ? null
        : typeof v === "string" ? (v.trim() || null)
        : undefined;
      await useCases.updateRestaurantConfig.setInstapay({
        handle: normalize(instapayHandle),
        phone: normalize(instapayPhone),
      });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Restaurant update failed:", err);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
