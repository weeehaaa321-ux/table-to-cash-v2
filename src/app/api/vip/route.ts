import { NextRequest, NextResponse } from "next/server";
import { legacyDb as db } from "@/infrastructure/composition";
import { requireStaffAuth } from "@/lib/api-auth";

async function resolveRestaurantId(id: string): Promise<string | null> {
  if (!id) return null;
  if (id.startsWith("c") && id.length > 10) return id;
  const r = await db.restaurant.findUnique({ where: { slug: id }, select: { id: true } });
  return r?.id || null;
}

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request);
  if (auth instanceof NextResponse) return auth;

  const url = new URL(request.url);
  const rawId = url.searchParams.get("restaurantId") || "";
  const restaurantId = await resolveRestaurantId(rawId);
  if (!restaurantId) {
    return NextResponse.json({ error: "restaurantId required" }, { status: 400 });
  }

  const guests = await db.vipGuest.findMany({
    where: { restaurantId },
    orderBy: { createdAt: "desc" },
  });

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

  const restaurantId = await resolveRestaurantId(rawId);
  if (!restaurantId) {
    return NextResponse.json({ error: "Restaurant not found" }, { status: 400 });
  }

  try {
    const guest = await db.vipGuest.create({
      data: {
        name,
        phone,
        address: address || null,
        addressNotes: addressNotes || null,
        locationLat: locationLat ?? null,
        locationLng: locationLng ?? null,
        restaurantId,
      },
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
      // Check for existing orders or open sessions before hard-deleting
      const [orderCount, openSessions] = await Promise.all([
        db.order.count({ where: { vipGuestId: id } }),
        db.tableSession.count({ where: { vipGuestId: id, status: "OPEN" } }),
      ]);
      if (openSessions > 0) {
        return NextResponse.json({ error: "VIP guest has an active session. Close it first." }, { status: 409 });
      }
      if (orderCount > 0) {
        // Deactivate instead of deleting to preserve order history
        await db.vipGuest.update({ where: { id }, data: { active: false } });
        return NextResponse.json({ ok: true, deactivated: true });
      }
      await db.vipGuest.delete({ where: { id } });
      return NextResponse.json({ ok: true });
    } catch (err) {
      console.error("VIP delete failed:", err);
      return NextResponse.json({ error: "Failed to delete VIP guest." }, { status: 500 });
    }
  }

  try {
    const guest = await db.vipGuest.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(phone !== undefined ? { phone } : {}),
        ...(address !== undefined ? { address } : {}),
        ...(addressNotes !== undefined ? { addressNotes } : {}),
        ...(locationLat !== undefined ? { locationLat } : {}),
        ...(locationLng !== undefined ? { locationLng } : {}),
        ...(active !== undefined ? { active } : {}),
      },
    });
    return NextResponse.json(guest);
  } catch (err) {
    console.error("VIP update failed:", err);
    return NextResponse.json({ error: "Failed to update VIP guest" }, { status: 500 });
  }
}
