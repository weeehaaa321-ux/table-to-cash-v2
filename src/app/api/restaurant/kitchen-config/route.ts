import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("restaurantId") || "";
  const id = await useCases.admin.resolveRestaurantId(raw);
  if (!id) return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
  const config = await useCases.admin.getKitchenConfig(id);
  return NextResponse.json(config);
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
