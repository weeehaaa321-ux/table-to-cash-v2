import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";
import { sendPushToStaff } from "@/lib/web-push";
import { requireStaffAuth } from "@/lib/api-auth";

const STAFF_VIEW_ROLES = ["CASHIER", "WAITER", "OWNER", "FLOOR_MANAGER"];
const CREATE_ROLES = ["CASHIER", "OWNER", "FLOOR_MANAGER"];
const UPDATE_ROLES = ["CASHIER", "WAITER", "OWNER", "FLOOR_MANAGER"];

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
    const realId = await useCases.sessions.resolveRestaurantId(restaurantId);
    if (!realId) return NextResponse.json({ settlements: [] });
    if (realId !== authed.restaurantId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const settlements = await useCases.cashier.listTodaysSettlements({
      restaurantId: realId,
      waiterId,
      cashierId,
      status,
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

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { cashierId, waiterId, amount, restaurantId } = body;

  if (!cashierId || !waiterId || !amount || !restaurantId) {
    return NextResponse.json({ error: "cashierId, waiterId, amount, restaurantId required" }, { status: 400 });
  }

  const authed = await requireStaffAuth(request, CREATE_ROLES);
  if (authed instanceof NextResponse) return authed;
  if (authed.role === "CASHIER" && cashierId !== authed.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (typeof amount !== "number" || amount <= 0 || !isFinite(amount)) {
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
  }

  try {
    const realId = await useCases.sessions.resolveRestaurantId(restaurantId);
    if (!realId) return NextResponse.json({ error: "Restaurant not found" }, { status: 400 });
    if (realId !== authed.restaurantId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const waiter = await useCases.cashier.findStaffScope(waiterId);
    if (!waiter || waiter.restaurantId !== realId) {
      return NextResponse.json({ error: "Waiter not found" }, { status: 400 });
    }

    const cashier = await useCases.cashier.findStaffName(cashierId);

    const settlement = await useCases.cashier.createSettlementWithRelations({
      amount,
      waiterId,
      cashierId,
      cashierName: cashier?.name || "Cashier",
      restaurantId: realId,
    });

    sendPushToStaff(waiterId, {
      title: { en: "Cash Settlement Request", ar: "طلب تسوية نقدية" },
      body: {
        en: `Cashier ${cashier?.name || ""} requests you settle ${amount} EGP`,
        ar: `الكاشير ${cashier?.name || ""} يطلب منك تسوية ${amount} جنيه`,
      },
      tag: `settle-${settlement.id}`,
      url: "/waiter",
    }).catch(() => {});

    await useCases.cashier.logSettlementMessage({
      cashierId,
      waiterId,
      text: `Settle ${amount} EGP cash to cashier ${cashier?.name || ""}`,
      settlementId: settlement.id,
      restaurantId: realId,
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

export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const { settlementId, action } = body;

  if (!settlementId || !action) {
    return NextResponse.json({ error: "settlementId and action required" }, { status: 400 });
  }

  const authed = await requireStaffAuth(request, UPDATE_ROLES);
  if (authed instanceof NextResponse) return authed;

  const existing = await useCases.cashier.findSettlementScope(settlementId);
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
      const settlement = await useCases.cashier.acceptSettlement(settlementId);
      sendPushToStaff(settlement.cashier.id, {
        title: { en: "Settlement Accepted", ar: "تم قبول التسوية" },
        body: {
          en: `${settlement.waiter.name} is bringing ${settlement.amount} EGP`,
          ar: `${settlement.waiter.name} في الطريق بـ ${settlement.amount} جنيه`,
        },
        tag: `settle-accepted-${settlementId}`,
        url: "/cashier",
      }).catch(() => {});
      return NextResponse.json({ success: true, status: "ACCEPTED" });
    }

    if (action === "confirm") {
      const settlement = await useCases.cashier.confirmSettlement(settlementId);
      sendPushToStaff(settlement.waiter.id, {
        title: { en: "Cash Settled", ar: "تمت التسوية" },
        body: {
          en: `Cashier confirmed receipt of ${settlement.amount} EGP`,
          ar: `الكاشير أكد استلام ${settlement.amount} جنيه`,
        },
        tag: `settle-confirmed-${settlementId}`,
        url: "/waiter",
      }).catch(() => {});
      return NextResponse.json({ success: true, status: "CONFIRMED" });
    }

    if (action === "reject") {
      await useCases.cashier.rejectSettlement(settlementId);
      return NextResponse.json({ success: true, status: "REJECTED" });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("Settlement update failed:", err);
    return NextResponse.json({ error: "Failed to update settlement" }, { status: 500 });
  }
}
