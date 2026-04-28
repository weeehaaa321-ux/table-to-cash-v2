import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";
import { requireOwnerAuth, requireStaffAuth } from "@/lib/api-auth";
import { defaultCloseTarget, persistClose } from "@/lib/daily-close";

// GET: List recent daily closes (latest 30) for this restaurant.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const restaurantId = url.searchParams.get("restaurantId") || "";
  if (!restaurantId) {
    return NextResponse.json({ closes: [] });
  }

  // Daily closes are book-of-record numbers — anyone with access to
  // them can read total revenue, comped value, per-waiter breakdown.
  // Lock to staff who'd legitimately review numbers; floor + cashier
  // need the day-end recap, not just owners.
  const authed = await requireStaffAuth(request, ["OWNER", "FLOOR_MANAGER", "CASHIER"]);
  if (authed instanceof NextResponse) return authed;
  const realId = await useCases.cashier.resolveRestaurantId(restaurantId);
  if (!realId) return NextResponse.json({ closes: [] });
  if (realId !== authed.restaurantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const closes = await useCases.cashier.listRecentDailyCloses(realId, 30);
    return NextResponse.json({
      closes: closes.map((c) => ({
        id: c.id,
        date: c.date.toISOString().slice(0, 10),
        closedAt: c.closedAt.toISOString(),
        closedByName: c.closedByName,
        totals: c.totals,
        notes: c.notes,
      })),
    });
  } catch (err) {
    console.error("Daily close list failed:", err);
    return NextResponse.json({ closes: [] });
  }
}

// POST: Snapshot today's totals and lock the day.
// Body: { restaurantId, date?, notes? }
// `date` defaults to today (Cairo). Refuses to overwrite an existing close
// — if the owner needs to amend, they delete first (no UI for that on
// purpose; deletions go through DB).
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { restaurantId, date, notes } = body as {
    restaurantId?: string;
    date?: string;
    notes?: string;
  };

  if (!restaurantId) {
    return NextResponse.json(
      { error: "restaurantId required" },
      { status: 400 },
    );
  }

  // Owner-only — closing locks the day's numbers for tax/accounting.
  // The caller's identity comes from the authenticated header, never
  // the body, so a phished cuid in someone's request log can't lock
  // the day on the owner's behalf.
  const authed = await requireOwnerAuth(request);
  if (authed instanceof NextResponse) return authed;
  if (authed.role !== "OWNER") {
    return NextResponse.json({ error: "Owner only" }, { status: 403 });
  }

  const realId = await useCases.cashier.resolveRestaurantId(restaurantId);
  if (!realId) return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });
  if (realId !== authed.restaurantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const staff = await useCases.staffManagement.findActorIdentity(authed.id);
  if (!staff) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const target = date ? new Date(date + "T00:00:00Z") : defaultCloseTarget();

  try {
    const result = await persistClose({
      restaurantId: realId,
      target,
      closedById: authed.id,
      closedByName: staff.name,
      notes,
    });

    if (result.kind === "exists") {
      return NextResponse.json(
        { error: "ALREADY_CLOSED", message: "This day is already closed" },
        { status: 409 },
      );
    }

    return NextResponse.json({
      success: true,
      ...result.close,
    });
  } catch (err) {
    console.error("Daily close failed:", err);
    return NextResponse.json({ error: "Close failed" }, { status: 500 });
  }
}
