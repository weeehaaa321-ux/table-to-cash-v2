import { NextRequest, NextResponse } from "next/server";
import { legacyDb as db } from "@/infrastructure/composition";
import { sendPushToStaff } from "@/lib/web-push";
import { requireStaffAuth } from "@/lib/api-auth";

const STAFF_VIEW_ROLES = ["CASHIER", "WAITER", "OWNER", "FLOOR_MANAGER"];
const CREATE_ROLES = ["CASHIER", "OWNER", "FLOOR_MANAGER"];
const UPDATE_ROLES = ["CASHIER", "WAITER", "OWNER", "FLOOR_MANAGER"];

async function resolveRestaurantId(id: string): Promise<string | null> {
  if (!id) return null;
  if (id.startsWith("c") && id.length > 10) return id;
  const restaurant = await db.restaurant.findUnique({
    where: { slug: id },
    select: { id: true },
  });
  return restaurant?.id || null;
}

// GET: List settlements for a restaurant (optionally filtered by waiterId or cashierId)
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const restaurantId = url.searchParams.get("restaurantId") || "";
  const waiterId = url.searchParams.get("waiterId");
  const cashierId = url.searchParams.get("cashierId");
  const status = url.searchParams.get("status");

  if (!restaurantId) {
    return NextResponse.json({ settlements: [] });
  }

  const authed = await requireStaffAuth(request, STAFF_VIEW_ROLES);
  if (authed instanceof NextResponse) return authed;

  try {
    const realId = await resolveRestaurantId(restaurantId);
    if (!realId) return NextResponse.json({ settlements: [] });
    if (realId !== authed.restaurantId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const where: Record<string, unknown> = { restaurantId: realId };
    if (waiterId) where.waiterId = waiterId;
    if (cashierId) where.cashierId = cashierId;
    if (status) where.status = status;

    // Only show today's settlements by default
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    where.requestedAt = { gte: todayStart };

    const settlements = await db.cashSettlement.findMany({
      where,
      include: {
        waiter: { select: { id: true, name: true } },
        cashier: { select: { id: true, name: true } },
      },
      orderBy: { requestedAt: "desc" },
    });

    return NextResponse.json({
      settlements: settlements.map((s) => ({
        id: s.id,
        amount: s.amount,
        status: s.status,
        waiterId: s.waiterId,
        waiterName: s.waiter.name,
        cashierId: s.cashierId,
        cashierName: s.cashier.name,
        requestedAt: s.requestedAt.toISOString(),
        acceptedAt: s.acceptedAt?.toISOString() || null,
        confirmedAt: s.confirmedAt?.toISOString() || null,
      })),
    });
  } catch (err) {
    console.error("Failed to fetch settlements:", err);
    return NextResponse.json({ settlements: [] });
  }
}

// POST: Cashier requests a waiter to settle cash
// Body: { cashierId, waiterId, amount, restaurantId }
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { cashierId, waiterId, amount, restaurantId } = body;

  if (!cashierId || !waiterId || !amount || !restaurantId) {
    return NextResponse.json({ error: "cashierId, waiterId, amount, restaurantId required" }, { status: 400 });
  }

  const authed = await requireStaffAuth(request, CREATE_ROLES);
  if (authed instanceof NextResponse) return authed;
  // Cashiers can only file settlements as themselves; manager/owner can
  // override (e.g. logging a paper-trail handover from staff who left).
  if (authed.role === "CASHIER" && cashierId !== authed.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (typeof amount !== "number" || amount <= 0 || !isFinite(amount)) {
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
  }

  try {
    const realId = await resolveRestaurantId(restaurantId);
    if (!realId) return NextResponse.json({ error: "Restaurant not found" }, { status: 400 });
    if (realId !== authed.restaurantId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Waiter must exist in this restaurant — prevents fake settlements
    // pointing at staff in another tenant.
    const waiter = await db.staff.findUnique({
      where: { id: waiterId },
      select: { restaurantId: true, role: true },
    });
    if (!waiter || waiter.restaurantId !== realId) {
      return NextResponse.json({ error: "Waiter not found" }, { status: 400 });
    }

    const cashier = await db.staff.findUnique({ where: { id: cashierId }, select: { name: true } });

    const settlement = await db.cashSettlement.create({
      data: {
        amount,
        waiterId,
        cashierId,
        cashierName: cashier?.name || "Cashier",
        restaurantId: realId,
      },
      include: {
        waiter: { select: { id: true, name: true } },
        cashier: { select: { id: true, name: true } },
      },
    });

    // Push notification to waiter
    sendPushToStaff(waiterId, {
      title: "Cash Settlement Request",
      body: `Cashier ${cashier?.name || ""} requests you settle ${amount} EGP`,
      tag: `settle-${settlement.id}`,
      url: "/waiter",
    }).catch(() => {});

    // Also send as a message so it shows in the waiter's message banner
    await db.message.create({
      data: {
        type: "command",
        from: cashierId,
        to: waiterId,
        text: `Settle ${amount} EGP cash to cashier ${cashier?.name || ""}`,
        command: `settle_cash:${settlement.id}`,
        restaurantId,
      },
    }).catch(() => {});

    return NextResponse.json({
      id: settlement.id,
      amount: settlement.amount,
      status: settlement.status,
      waiterName: settlement.waiter.name,
      cashierName: settlement.cashier.name,
    }, { status: 201 });
  } catch (err) {
    console.error("Failed to create settlement:", err);
    return NextResponse.json({ error: "Failed to create settlement" }, { status: 500 });
  }
}

// PATCH: Update settlement status
// Body: { settlementId, action: "accept" | "confirm" | "reject" }
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { settlementId, action } = body;

  if (!settlementId || !action) {
    return NextResponse.json({ error: "settlementId and action required" }, { status: 400 });
  }

  const authed = await requireStaffAuth(request, UPDATE_ROLES);
  if (authed instanceof NextResponse) return authed;

  // Each action belongs to one role. Waiter accepts, cashier confirms.
  // Reject can come from either side. Manager/owner override either.
  const existing = await db.cashSettlement.findUnique({
    where: { id: settlementId },
    select: { restaurantId: true, waiterId: true, cashierId: true, status: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Settlement not found" }, { status: 404 });
  }
  if (existing.restaurantId !== authed.restaurantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const isOverride = authed.role === "OWNER" || authed.role === "FLOOR_MANAGER";
  if (action === "accept" && !isOverride && authed.id !== existing.waiterId) {
    return NextResponse.json({ error: "Only the assigned waiter can accept" }, { status: 403 });
  }
  if (action === "confirm" && !isOverride && authed.id !== existing.cashierId) {
    return NextResponse.json({ error: "Only the requesting cashier can confirm" }, { status: 403 });
  }
  if (action === "reject" && !isOverride && authed.id !== existing.waiterId && authed.id !== existing.cashierId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    if (action === "accept") {
      // Waiter accepts — they will bring the cash
      const settlement = await db.cashSettlement.update({
        where: { id: settlementId },
        data: { status: "ACCEPTED", acceptedAt: new Date() },
        include: { waiter: { select: { name: true } }, cashier: { select: { id: true, name: true } } },
      });

      // Notify cashier that waiter accepted
      sendPushToStaff(settlement.cashier.id, {
        title: "Settlement Accepted",
        body: `${settlement.waiter.name} is bringing ${settlement.amount} EGP`,
        tag: `settle-accepted-${settlementId}`,
        url: "/cashier",
      }).catch(() => {});

      return NextResponse.json({ success: true, status: "ACCEPTED" });
    }

    if (action === "confirm") {
      // Cashier confirms they received the cash
      const settlement = await db.cashSettlement.update({
        where: { id: settlementId },
        data: { status: "CONFIRMED", confirmedAt: new Date() },
        include: { waiter: { select: { id: true, name: true } } },
      });

      // Notify waiter that cash was confirmed received
      sendPushToStaff(settlement.waiter.id, {
        title: "Cash Settled",
        body: `Cashier confirmed receipt of ${settlement.amount} EGP`,
        tag: `settle-confirmed-${settlementId}`,
        url: "/waiter",
      }).catch(() => {});

      return NextResponse.json({ success: true, status: "CONFIRMED" });
    }

    if (action === "reject") {
      await db.cashSettlement.update({
        where: { id: settlementId },
        data: { status: "REJECTED" },
      });
      return NextResponse.json({ success: true, status: "REJECTED" });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("Settlement update failed:", err);
    return NextResponse.json({ error: "Failed to update settlement" }, { status: 500 });
  }
}
