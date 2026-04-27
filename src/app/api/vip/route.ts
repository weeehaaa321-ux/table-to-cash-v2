import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";
import { requireStaffAuth } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const rawId = url.searchParams.get("restaurantId") || "";
  const restaurantId = await useCases.vip.resolveRestaurantId(rawId);
  if (!restaurantId) {
    return NextResponse.json({ error: "restaurantId required" }, { status: 400 });
  }

  const guests = await useCases.vip.listAllForAdmin(restaurantId);
  return NextResponse.json(guests);
}

export async function POST(request: NextRequest) {
  const auth = await requireStaffAuth(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const { name, phone, address, addressNotes, locationLat, locationLng, restaurantId: rawId } = body;

  if (!name || !phone || !rawId) {
    return NextResponse.json({ error: "name, phone, and restaurantId required" }, { status: 400 });
  }

  const restaurantId = await useCases.vip.resolveRestaurantId(rawId);
  if (!restaurantId) {
    return NextResponse.json({ error: "Restaurant not found" }, { status: 400 });
  }

  try {
    const guest = await useCases.vip.create({
      name,
      phone,
      address: address || null,
      addressNotes: addressNotes || null,
      locationLat: locationLat ?? null,
      locationLng: locationLng ?? null,
      restaurantId,
    });
    return NextResponse.json(guest, { status: 201 });
  } catch (err: unknown) {
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      return NextResponse.json({ error: "A VIP guest with this phone number already exists" }, { status: 409 });
    }
    console.error("VIP creation failed:", err);
    return NextResponse.json({ error: "Failed to create VIP guest" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireStaffAuth(request);
  if (auth instanceof NextResponse) return auth;

  const body = await request.json();
  const { id, name, phone, address, addressNotes, locationLat, locationLng, active } = body;

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  if (body.delete) {
    try {
      const { orderCount, openSessions } = await useCases.vip.countOrdersAndOpenSessions(id);
      if (openSessions > 0) {
        return NextResponse.json({ error: "VIP guest has an active session. Close it first." }, { status: 409 });
      }
      if (orderCount > 0) {
        await useCases.vip.deactivate(id);
        return NextResponse.json({ ok: true, deactivated: true });
      }
      await useCases.vip.hardDelete(id);
      return NextResponse.json({ ok: true });
    } catch (err) {
      console.error("VIP delete failed:", err);
      return NextResponse.json({ error: "Failed to delete VIP guest." }, { status: 500 });
    }
  }

  try {
    const guest = await useCases.vip.update(id, {
      ...(name !== undefined ? { name } : {}),
      ...(phone !== undefined ? { phone } : {}),
      ...(address !== undefined ? { address } : {}),
      ...(addressNotes !== undefined ? { addressNotes } : {}),
      ...(locationLat !== undefined ? { locationLat } : {}),
      ...(locationLng !== undefined ? { locationLng } : {}),
      ...(active !== undefined ? { active } : {}),
    });
    return NextResponse.json(guest);
  } catch (err) {
    console.error("VIP update failed:", err);
    return NextResponse.json({ error: "Failed to update VIP guest" }, { status: 500 });
  }
}
