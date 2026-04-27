import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";
import { getShiftCount } from "@/lib/shifts";
import { transferWaiterSessions } from "@/lib/waiter-transfer";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const restaurantId = url.searchParams.get("restaurantId") || "";

  try {
    const realId = await useCases.staffManagement.resolveRestaurantId(restaurantId);
    if (!realId) return NextResponse.json([]);
    const staff = await useCases.staffManagement.list(realId);
    return NextResponse.json(staff);
  } catch (err) {
    console.error("Failed to fetch staff:", err);
    return NextResponse.json({ error: "Failed to fetch staff" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { name, pin, role, restaurantId } = body;

  if (!name || !pin || !restaurantId) {
    return NextResponse.json({ error: "name, pin, and restaurantId are required" }, { status: 400 });
  }

  if (pin.length < 4 || pin.length > 6 || !/^\d+$/.test(pin)) {
    return NextResponse.json({ error: "PIN must be 4-6 digits" }, { status: 400 });
  }

  try {
    const realId = await useCases.staffManagement.resolveRestaurantId(restaurantId);
    if (!realId) return NextResponse.json({ error: "Restaurant not found" }, { status: 400 });

    if (await useCases.staffManagement.pinIsTaken(realId, pin)) {
      return NextResponse.json({ error: "PIN already in use" }, { status: 409 });
    }

    const finalRole = role || "WAITER";
    if (finalRole === "OWNER") {
      return NextResponse.json(
        { error: "Owner accounts cannot be created via the staff panel." },
        { status: 403 }
      );
    }

    const staff = await useCases.staffManagement.create({
      name, pin, role: finalRole, restaurantId: realId,
    });
    return NextResponse.json(staff, { status: 201 });
  } catch (err) {
    console.error("Failed to create staff:", err);
    return NextResponse.json({ error: "Failed to create staff" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { id, name, pin, active, shift } = body;

  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const current = await useCases.staffManagement.findCurrentForUpdate(id);
    if (!current) return NextResponse.json({ error: "Staff not found" }, { status: 404 });

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (pin !== undefined) {
      if (await useCases.staffManagement.pinIsTaken(current.restaurantId, pin, id)) {
        return NextResponse.json({ error: "PIN already in use" }, { status: 409 });
      }
      data.pin = pin;
    }
    if (active !== undefined) data.active = active;

    if (shift !== undefined) {
      const maxShift = getShiftCount(current.role);
      const s = Number(shift);
      if (!Number.isInteger(s) || s < 0 || s > maxShift) {
        return NextResponse.json(
          { error: `Invalid shift for role ${current.role}. Allowed: 0-${maxShift}.` },
          { status: 400 }
        );
      }
      data.shift = s;
    }

    const staff = await useCases.staffManagement.update(id, data);

    if (
      current.role === "WAITER" &&
      current.active === true &&
      active === false
    ) {
      transferWaiterSessions(id, current.restaurantId).catch((err) =>
        console.error("Waiter transfer on deactivate failed:", err)
      );
    }

    return NextResponse.json(staff);
  } catch (err) {
    console.error("Failed to update staff:", err);
    return NextResponse.json({ error: "Failed to update staff" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { id } = body;
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  try {
    const target = await useCases.staffManagement.findRoleById(id);
    if (!target) {
      return NextResponse.json({ error: "Staff not found" }, { status: 404 });
    }
    if (target.role === "OWNER") {
      return NextResponse.json(
        { error: "Owner accounts cannot be deleted. Deactivate instead." },
        { status: 409 }
      );
    }

    await useCases.staffManagement.deleteWithCleanup(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to delete staff:", err);
    return NextResponse.json({ error: "Failed to delete staff" }, { status: 500 });
  }
}
