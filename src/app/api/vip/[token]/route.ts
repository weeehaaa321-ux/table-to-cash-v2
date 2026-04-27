import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";

export async function GET(
  _request: NextRequest,
  ctx: RouteContext<"/api/vip/[token]">
) {
  const { token } = await ctx.params;

  if (!token) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }

  try {
    const guest = await useCases.vip.findByTokenWithRestaurantId(token);
    if (!guest || !guest.active) {
      return NextResponse.json({ error: "VIP link not found or inactive" }, { status: 404 });
    }

    return NextResponse.json({
      id: guest.id,
      name: guest.name,
      phone: guest.phone,
      address: guest.address,
      addressNotes: guest.addressNotes,
      locationLat: guest.locationLat,
      locationLng: guest.locationLng,
      restaurant: guest.restaurant,
    });
  } catch (err) {
    console.error("VIP token lookup failed:", err);
    return NextResponse.json({ error: "Failed to load VIP data" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<"/api/vip/[token]">
) {
  const { token } = await ctx.params;
  const body = await request.json();

  try {
    const guest = await useCases.vip.updateByToken(token, {
      ...(body.address !== undefined ? { address: body.address } : {}),
      ...(body.addressNotes !== undefined ? { addressNotes: body.addressNotes } : {}),
      ...(body.locationLat !== undefined ? { locationLat: body.locationLat } : {}),
      ...(body.locationLng !== undefined ? { locationLng: body.locationLng } : {}),
    });
    return NextResponse.json(guest);
  } catch (err) {
    console.error("VIP update failed:", err);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}
