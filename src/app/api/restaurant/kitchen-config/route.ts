import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";

// Kitchen capacity/config changes maybe a few times per quarter. SWR
// for 60s + 5min stale window lets the CDN absorb the spammy reads
// that come from every role page poking this on mount.
const SWR_CONFIG = {
  "Cache-Control": "public, max-age=60, stale-while-revalidate=300",
} as const;

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("restaurantId") || "";
  const id = await useCases.admin.resolveRestaurantId(raw);
  if (!id) return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
  const config = await useCases.admin.getKitchenConfig(id);
  return NextResponse.json(config, { headers: SWR_CONFIG });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const raw = body.restaurantId as string | undefined;
  if (!raw) return NextResponse.json({ error: "restaurantId required" }, { status: 400 });
  const id = await useCases.admin.resolveRestaurantId(raw);
  if (!id) return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
  const config = await useCases.admin.setKitchenConfigNormalized(id, body.config ?? body);
  return NextResponse.json(config);
}

export async function POST(request: NextRequest) {
  return PUT(request);
}
