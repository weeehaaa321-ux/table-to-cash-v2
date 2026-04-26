import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { normalizeKitchenConfig } from "@/lib/kitchen-config";

async function resolveRestaurantId(id: string): Promise<string | null> {
  if (!id) return null;
  if (id.startsWith("c") && id.length > 10) return id;
  const r = await db.restaurant.findUnique({ where: { slug: id }, select: { id: true } });
  return r?.id || null;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("restaurantId") || "";
  const id = await resolveRestaurantId(raw);
  if (!id) return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });

  const r = await db.restaurant.findUnique({
    where: { id },
    select: { kitchenConfig: true },
  });
  return NextResponse.json(normalizeKitchenConfig(r?.kitchenConfig));
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const raw = body.restaurantId as string | undefined;
  if (!raw) return NextResponse.json({ error: "restaurantId required" }, { status: 400 });

  const id = await resolveRestaurantId(raw);
  if (!id) return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });

  const config = normalizeKitchenConfig(body.config ?? body);
  await db.restaurant.update({
    where: { id },
    data: { kitchenConfig: config },
  });
  return NextResponse.json(config);
}

export async function POST(request: NextRequest) {
  // Alias for PUT
  return PUT(request);
}
