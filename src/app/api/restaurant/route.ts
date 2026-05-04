// Migrated to layered architecture. Behavior + response shapes byte-identical to source.

import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";
import { db } from "@/lib/db";
import { invalidateServiceModelCache } from "@/application/session/SessionUseCases";

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
    // Service model lives on a Prisma row that the use-case wrapper
    // doesn't expose; read it directly. Drives the dashboard toggle
    // and informs role-page redirects (WAITER/RUNNER).
    const cfg = await db.restaurant.findUnique({
      where: { id: restaurant.id },
      select: { serviceModel: true, serviceChargePercent: true },
    });
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
        serviceModel: cfg?.serviceModel ?? "WAITER",
        serviceChargePercent: cfg?.serviceChargePercent ? Number(cfg.serviceChargePercent) : 0,
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
    const { slug, waiterCapacity, instapayHandle, instapayPhone, serviceModel, serviceChargePercent } = body;
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
    // Service-model + service-charge toggle. The user-facing knob the
    // owner taps to switch between waiter and runner flows. Cache is
    // invalidated immediately so the next request reads the new value
    // instead of waiting for the 30-second TTL.
    if (serviceModel !== undefined || serviceChargePercent !== undefined) {
      const r = await db.restaurant.findUnique({ where: { slug }, select: { id: true } });
      if (!r) return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
      const data: Record<string, unknown> = {};
      if (serviceModel === "WAITER" || serviceModel === "RUNNER") {
        data.serviceModel = serviceModel;
      }
      if (typeof serviceChargePercent === "number" && serviceChargePercent >= 0 && serviceChargePercent <= 100) {
        data.serviceChargePercent = serviceChargePercent;
      }
      if (Object.keys(data).length > 0) {
        await db.restaurant.update({ where: { id: r.id }, data });
        invalidateServiceModelCache(r.id);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Restaurant update failed:", err);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}
