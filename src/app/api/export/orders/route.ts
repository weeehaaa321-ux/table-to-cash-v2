import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { toNum } from "@/lib/money";

async function resolveRestaurantId(id: string): Promise<string | null> {
  if (!id) return null;
  if (id.startsWith("c") && id.length > 10) return id;
  const r = await db.restaurant.findUnique({
    where: { slug: id },
    select: { id: true },
  });
  return r?.id || null;
}

// CSV cell escape: quote anything that contains comma, quote, or newline,
// and double internal quotes per RFC 4180.
function csv(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

// GET /api/export/orders?restaurantId=&from=YYYY-MM-DD&to=YYYY-MM-DD
//
// Returns one row per order (not per item — accountants want one line
// per ticket). Items are joined into a single column for traceability.
// `from` is inclusive 00:00, `to` is inclusive 23:59:59.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const restaurantId = url.searchParams.get("restaurantId") || "";
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");

  if (!restaurantId || !fromStr || !toStr) {
    return NextResponse.json(
      { error: "restaurantId, from, to required" },
      { status: 400 },
    );
  }

  const realId = await resolveRestaurantId(restaurantId);
  if (!realId) return NextResponse.json({ error: "Restaurant not found" }, { status: 404 });

  const from = new Date(fromStr + "T00:00:00.000Z");
  const to = new Date(toStr + "T23:59:59.999Z");
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    return NextResponse.json({ error: "Invalid date" }, { status: 400 });
  }

  try {
    const orders = await db.order.findMany({
      where: {
        restaurantId: realId,
        createdAt: { gte: from, lte: to },
      },
      include: {
        items: { include: { menuItem: { select: { name: true } } } },
        table: { select: { number: true } },
        session: {
          select: {
            id: true,
            waiter: { select: { name: true } },
            guestCount: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const header = [
      "order_id", "order_number", "created_at", "paid_at",
      "status", "table", "guest_count", "waiter",
      "subtotal", "tip", "total", "payment_method",
      "items", "comped_value", "cancelled_value",
      "session_id",
    ];

    const rows = orders.map((o) => {
      const itemsStr = o.items
        .map((it) => {
          const flag = it.cancelled ? " [VOID]" : it.comped ? " [COMP]" : "";
          return `${it.quantity}x ${it.menuItem?.name ?? "Deleted item"}${flag} @${it.price}`;
        })
        .join(" | ");
      const compedValue = o.items
        .filter((i) => i.comped)
        .reduce((s, i) => s + toNum(i.price) * i.quantity, 0);
      const cancelledValue = o.items
        .filter((i) => i.cancelled)
        .reduce((s, i) => s + toNum(i.price) * i.quantity, 0);
      return [
        o.id,
        o.orderNumber,
        o.createdAt.toISOString(),
        o.paidAt?.toISOString() || "",
        o.status,
        o.table?.number ?? "",
        o.session?.guestCount ?? "",
        o.session?.waiter?.name ?? "",
        o.subtotal,
        o.tip,
        o.total,
        o.paymentMethod ?? "",
        itemsStr,
        compedValue,
        cancelledValue,
        o.sessionId ?? "",
      ].map(csv).join(",");
    });

    // BOM so Excel opens UTF-8 correctly (Arabic item names).
    const csvText = "\uFEFF" + header.join(",") + "\n" + rows.join("\n") + "\n";

    return new NextResponse(csvText, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="orders_${fromStr}_${toStr}.csv"`,
      },
    });
  } catch (err) {
    console.error("CSV export failed:", err);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
