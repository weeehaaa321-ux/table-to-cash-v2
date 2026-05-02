import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";
import { toNum } from "@/lib/money";

// GET: Fetch full invoice data for a session.
//
// Returns every settled order in the session grouped into "rounds" (one
// round per distinct paidAt). The print view renders the MOST RECENT
// round as the headline and lists previous rounds in a compact footer,
// so a cashier holding the paper can read both "this payment" and "what
// this table has paid lifetime".
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");

  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  try {
    const session = await useCases.cashier.fetchSettledInvoice(sessionId);

    if (!session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    type InvoiceItem = {
      name: string;
      nameAr: string | null;
      quantity: number;
      price: number;
      addOns: string[];
      notes: string | null;
      comped?: boolean;
      cancelled?: boolean;
    };
    type InvoiceRound = {
      index: number;
      paidAt: string;
      paymentMethod: string | null;
      items: InvoiceItem[];
      subtotal: number;
      guestNumber: number | null;
      guestName: string | null;
    };

    // Group by paidAt — one round per settlement event.
    const byPaidAt = new Map<string, typeof session.orders>();
    for (const o of session.orders) {
      const key = o.paidAt!.toISOString();
      if (!byPaidAt.has(key)) byPaidAt.set(key, []);
      byPaidAt.get(key)!.push(o);
    }
    const rounds: InvoiceRound[] = Array.from(byPaidAt.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([paidAt, group], i) => {
        const items: InvoiceItem[] = [];
        let subtotal = 0;
        for (const o of group) {
          subtotal += toNum(o.total);
          for (const it of o.items) {
            // Skip cancelled rows entirely — guest never owed for them.
            if (it.cancelled) continue;
            items.push({
              name: it.menuItem?.name ?? "Deleted item",
              nameAr: it.menuItem?.nameAr ?? null,
              quantity: it.quantity,
              // Comped items print at 0 EGP so the guest sees the gesture
              // but isn't charged. Order.total was already re-summed
              // server-side excluding comped rows when the comp happened,
              // so the round subtotal is correct without further adjustment.
              price: it.comped ? 0 : toNum(it.price),
              addOns: it.addOns,
              notes: it.notes,
              comped: it.comped || undefined,
            });
          }
        }
        // A round is the set of orders settled together (same paidAt).
        // For guest-by-guest pay, all orders in one round will share
        // the same guestNumber / guestName because the cashier confirms
        // one guest at a time. Take the first non-null value for each.
        const guestNumber =
          group.find((o) => o.guestNumber != null)?.guestNumber ?? null;
        const guestName =
          group.find((o) => (o as { guestName?: string | null }).guestName)
            ?.guestName ?? null;
        return {
          index: i + 1,
          paidAt,
          paymentMethod: group[0].paymentMethod ?? null,
          items,
          subtotal: Math.round(subtotal),
          guestNumber,
          guestName,
        };
      });

    // Lifetime merge for the legacy `items` / `total` fields — kept so
    // older print code paths or consumers that don't know about rounds
    // still get something reasonable.
    const allItems: InvoiceItem[] = rounds.flatMap((r) => r.items);
    const subtotal = rounds.reduce((s, r) => s + r.subtotal, 0);
    const lastRound = rounds[rounds.length - 1];

    return NextResponse.json({
      restaurantName: session.restaurant.name,
      currency: session.restaurant.currency || "EGP",
      tableNumber: session.table?.number ?? null,
      guestCount: session.guestCount,
      waiterName: session.waiter?.name || null,
      openedAt: session.openedAt.toISOString(),
      closedAt: session.closedAt?.toISOString() || null,
      paymentMethod: lastRound?.paymentMethod ?? null,
      items: allItems,
      subtotal,
      total: subtotal,
      orderCount: session.orders.length,
      sessionId: session.id,
      rounds,
    });
  } catch (err) {
    console.error("Invoice fetch failed:", err);
    return NextResponse.json({ error: "Failed to fetch invoice" }, { status: 500 });
  }
}
