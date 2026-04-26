import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireStaffAuth } from "@/lib/api-auth";
import { toNum } from "@/lib/money";

// ═══════════════════════════════════════════════════════
// CASH DRAWER
//
// One CashDrawer row per "open → close" cycle by a cashier. Opening
// float is the physical cash the cashier counted into the till at the
// start of the shift. At close, expected = openingFloat + sum(CASH
// orders paid since openedAt); variance = closingCount - expectedCash.
//
// Drawer ownership is enforced server-side: the requested cashierId
// (GET, POST) and drawerId (PATCH) must belong to the authenticated
// caller, or the caller must be OWNER/FLOOR_MANAGER overriding. Without
// this, anyone could open a drawer with a 1M EGP opening float in a
// cashier's name, or close someone else's drawer with a fake count.
// ═══════════════════════════════════════════════════════

const DRAWER_ROLES = ["CASHIER", "OWNER", "FLOOR_MANAGER"];

async function resolveRestaurantId(id: string): Promise<string | null> {
  if (!id) return null;
  if (id.startsWith("c") && id.length > 10) return id;
  const r = await db.restaurant.findUnique({ where: { slug: id }, select: { id: true } });
  return r?.id || null;
}

// GET ?restaurantId=&cashierId= — returns the cashier's currently open
// drawer, or null if none. Also returns expectedCash-so-far so the UI
// can show a running expected total before the cashier counts out.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const rawId = url.searchParams.get("restaurantId") || "";
  const cashierId = url.searchParams.get("cashierId") || "";

  if (!rawId || !cashierId) {
    return NextResponse.json({ error: "restaurantId and cashierId required" }, { status: 400 });
  }

  const authed = await requireStaffAuth(request, DRAWER_ROLES);
  if (authed instanceof NextResponse) return authed;
  // A cashier can only read their own drawer; managers/owners can read
  // any cashier's drawer in their restaurant.
  if (authed.role === "CASHIER" && cashierId !== authed.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const realId = await resolveRestaurantId(rawId);
    if (!realId) return NextResponse.json({ drawer: null });
    if (realId !== authed.restaurantId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const drawer = await db.cashDrawer.findFirst({
      where: { restaurantId: realId, cashierId, closedAt: null },
      orderBy: { openedAt: "desc" },
    });

    if (!drawer) return NextResponse.json({ drawer: null });

    // Running expected cash = openingFloat + CASH orders paid since open.
    const agg = await db.order.aggregate({
      where: {
        restaurantId: realId,
        paymentMethod: "CASH",
        paidAt: { gte: drawer.openedAt },
        status: { not: "CANCELLED" },
      },
      _sum: { total: true },
    });
    const cashSince = toNum(agg._sum.total);
    const openingFloat = toNum(drawer.openingFloat);

    return NextResponse.json({
      drawer: {
        id: drawer.id,
        openedAt: drawer.openedAt.toISOString(),
        openingFloat,
        cashSince,
        expectedSoFar: openingFloat + cashSince,
      },
    });
  } catch (err) {
    console.error("drawer GET failed:", err);
    return NextResponse.json({ error: "Failed to load drawer" }, { status: 500 });
  }
}

// POST — open a new drawer. body: { restaurantId, cashierId, openingFloat }
// Fails if this cashier already has an open drawer.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { restaurantId, cashierId, openingFloat } = body as {
    restaurantId?: string;
    cashierId?: string;
    openingFloat?: number;
  };

  if (!restaurantId || !cashierId || typeof openingFloat !== "number" || openingFloat < 0 || !isFinite(openingFloat)) {
    return NextResponse.json({ error: "restaurantId, cashierId, and non-negative openingFloat required" }, { status: 400 });
  }

  const authed = await requireStaffAuth(request, DRAWER_ROLES);
  if (authed instanceof NextResponse) return authed;
  // Cashiers can only open their own drawer. Managers/owners may open
  // a drawer on behalf of a cashier (rare — typically when a cashier
  // forgot to open before taking the first order).
  if (authed.role === "CASHIER" && cashierId !== authed.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const realId = await resolveRestaurantId(restaurantId);
    if (!realId) return NextResponse.json({ error: "restaurant not found" }, { status: 404 });
    if (realId !== authed.restaurantId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const existing = await db.cashDrawer.findFirst({
      where: { restaurantId: realId, cashierId, closedAt: null },
    });
    if (existing) {
      return NextResponse.json(
        { error: "ALREADY_OPEN", message: "Close your current drawer before opening a new one.", drawerId: existing.id },
        { status: 409 }
      );
    }

    const drawer = await db.cashDrawer.create({
      data: { restaurantId: realId, cashierId, openingFloat: Math.round(openingFloat) },
    });

    return NextResponse.json({ drawer: { id: drawer.id, openedAt: drawer.openedAt.toISOString(), openingFloat: toNum(drawer.openingFloat) } });
  } catch (err) {
    console.error("drawer POST failed:", err);
    return NextResponse.json({ error: "Failed to open drawer" }, { status: 500 });
  }
}

// PATCH — close a drawer. body: { drawerId, closingCount, notes? }
// Computes expected and variance server-side so the cashier can't fudge.
export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { drawerId, closingCount, notes } = body as {
    drawerId?: string;
    closingCount?: number;
    notes?: string;
  };

  if (!drawerId || typeof closingCount !== "number" || closingCount < 0 || !isFinite(closingCount)) {
    return NextResponse.json({ error: "drawerId and non-negative closingCount required" }, { status: 400 });
  }

  const authed = await requireStaffAuth(request, DRAWER_ROLES);
  if (authed instanceof NextResponse) return authed;

  try {
    const drawer = await db.cashDrawer.findUnique({ where: { id: drawerId } });
    if (!drawer) return NextResponse.json({ error: "drawer not found" }, { status: 404 });
    if (drawer.closedAt) return NextResponse.json({ error: "ALREADY_CLOSED" }, { status: 409 });
    if (drawer.restaurantId !== authed.restaurantId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (authed.role === "CASHIER" && drawer.cashierId !== authed.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const agg = await db.order.aggregate({
      where: {
        restaurantId: drawer.restaurantId,
        paymentMethod: "CASH",
        paidAt: { gte: drawer.openedAt },
        status: { not: "CANCELLED" },
      },
      _sum: { total: true },
    });
    const cashSince = Math.round(toNum(agg._sum.total));
    const expected = Math.round(toNum(drawer.openingFloat) + cashSince);
    const count = Math.round(closingCount);
    const variance = count - expected;

    const closed = await db.cashDrawer.update({
      where: { id: drawerId },
      data: {
        closedAt: new Date(),
        closingCount: count,
        expectedCash: expected,
        variance,
        notes: notes?.trim() || null,
      },
    });

    return NextResponse.json({
      drawer: {
        id: closed.id,
        openingFloat: toNum(closed.openingFloat),
        expectedCash: expected,
        closingCount: count,
        variance,
        cashSince,
      },
    });
  } catch (err) {
    console.error("drawer PATCH failed:", err);
    return NextResponse.json({ error: "Failed to close drawer" }, { status: 500 });
  }
}
