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

// GET: List all tables for a restaurant
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const restaurantId = url.searchParams.get("restaurantId") || "";

  try {
    const realId = await resolveRestaurantId(restaurantId);
    if (!realId) {
      return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
    }

    const tables = await db.table.findMany({
      where: { restaurantId: realId },
      select: { id: true, number: true, label: true },
      orderBy: { number: "asc" },
    });

    return NextResponse.json({ tables });
  } catch (err) {
    console.error("Failed to fetch tables:", err);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

// POST: Add a new table
// Body: { restaurantId, number?, label? }
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { restaurantId } = body;

  try {
    const realId = await resolveRestaurantId(restaurantId);
    if (!realId) {
      return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
    }

    // Find the next available table number
    const maxTable = await db.table.findFirst({
      where: { restaurantId: realId },
      orderBy: { number: "desc" },
      select: { number: true },
    });
    const nextNumber = (maxTable?.number || 0) + 1;

    const table = await db.table.create({
      data: {
        number: nextNumber,
        label: body.label || `Table ${nextNumber}`,
        restaurantId: realId,
      },
    });

    return NextResponse.json({ id: table.id, number: table.number, label: table.label }, { status: 201 });
  } catch (err) {
    console.error("Failed to add table:", err);
    return NextResponse.json({ error: "Failed to add table" }, { status: 500 });
  }
}

// DELETE: Remove a table (only if no active session)
// Body: { restaurantId, tableNumber }
export async function DELETE(request: NextRequest) {
  const body = await request.json();
  const { restaurantId, tableNumber } = body;

  if (!tableNumber) {
    return NextResponse.json({ error: "tableNumber required" }, { status: 400 });
  }

  try {
    const realId = await resolveRestaurantId(restaurantId);
    if (!realId) {
      return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
    }

    const table = await db.table.findUnique({
      where: { restaurantId_number: { restaurantId: realId, number: tableNumber } },
      include: {
        sessions: { where: { status: "OPEN" }, select: { id: true } },
      },
    });

    if (!table) {
      return NextResponse.json({ error: "Table not found" }, { status: 404 });
    }

    if (table.sessions.length > 0) {
      return NextResponse.json({ error: "Table has an active session — close it first" }, { status: 409 });
    }

    // Delete related records first (join requests → ratings → order items → orders → sessions → table)
    const tableSessions = await db.tableSession.findMany({ where: { tableId: table.id }, select: { id: true } });
    const tableSessionIds = tableSessions.map((s) => s.id);
    if (tableSessionIds.length > 0) {
      await db.joinRequest.deleteMany({ where: { sessionId: { in: tableSessionIds } } }).catch(() => {});
      await db.rating.deleteMany({ where: { sessionId: { in: tableSessionIds } } }).catch(() => {});
    }
    const tableOrders = await db.order.findMany({ where: { tableId: table.id }, select: { id: true } });
    const tableOrderIds = tableOrders.map((o) => o.id);
    if (tableOrderIds.length > 0) {
      await db.orderItem.deleteMany({ where: { orderId: { in: tableOrderIds } } });
    }
    await db.order.deleteMany({ where: { tableId: table.id } });
    await db.tableSession.deleteMany({ where: { tableId: table.id } });
    await db.table.delete({ where: { id: table.id } });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Failed to remove table:", err);
    return NextResponse.json({ error: "Failed to remove table" }, { status: 500 });
  }
}
