import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";
import { toNum } from "@/lib/money";
import { Prisma } from "@/generated/prisma/client";

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
      // Activity time-billing surface. activity.minutes is the elapsed
      // duration the guest is being charged for (rounded up minute);
      // activity.pricePerHour is the rate. The receipt renderer uses
      // this to print "Kayak (1h 32m) @ 500/hr = 767" instead of a
      // simple qty × price.
      activity?: {
        minutes: number;
        pricePerHour: number;
        running: boolean;
      };
    };
    type InvoiceRound = {
      index: number;
      paidAt: string;
      paymentMethod: string | null;
      items: InvoiceItem[];
      // Gross subtotal of the round before discount — what the items
      // actually cost. Receipt shows this on the line above the
      // discount + collected lines.
      subtotal: number;
      // EGP discount applied to this round (cashier-entered at confirm
      // time). 0 when none. Always whole-EGP, capped at subtotal.
      discount: number;
      // Mandatory service charge (RUNNER mode). 0 in WAITER mode.
      // Receipt renders it as a separate line so the guest sees what
      // the auto-add was.
      serviceCharge: number;
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
        let discount = 0;
        let serviceCharge = 0;
        for (const o of group) {
          subtotal += toNum(o.total);
          // Discount + serviceCharge columns added 2026-05-04. Older
          // paid orders never have them set; coalesce keeps historical
          // totals intact (sum stays at gross when both are 0/null).
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const oDisc = (o as any).discount as Prisma.Decimal | number | null | undefined;
          discount += toNum(oDisc ?? 0);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const oSc = (o as any).serviceCharge as Prisma.Decimal | number | null | undefined;
          serviceCharge += toNum(oSc ?? 0);
          for (const it of o.items) {
            // Skip cancelled rows entirely — guest never owed for them.
            if (it.cancelled) continue;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const itAny = it as any;
            const pricePerHour = itAny.menuItem?.pricePerHour != null
              ? toNum(itAny.menuItem.pricePerHour)
              : 0;
            const startedAt = itAny.activityStartedAt as Date | null | undefined;
            const stoppedAt = itAny.activityStoppedAt as Date | null | undefined;
            let activity: InvoiceItem["activity"] | undefined;
            let unitPrice = it.comped ? 0 : toNum(it.price);
            if (pricePerHour > 0 && startedAt) {
              // Legacy timer-running activity item: duration was the
              // billed time. Kept for any historical orders that still
              // carry activityStartedAt.
              const end = stoppedAt ?? new Date();
              const minutes = Math.max(1, Math.ceil((end.getTime() - startedAt.getTime()) / 60000));
              activity = {
                minutes,
                pricePerHour,
                running: !stoppedAt,
              };
              unitPrice = it.comped ? 0 : Math.ceil((minutes / 60) * pricePerHour);
            } else if (pricePerHour > 0 && it.quantity > 0) {
              // Pre-purchased hours: the cart's hour picker stored the
              // count as quantity. Render it as a duration so the
              // receipt reads "Kayak (2 hrs) @ 500/hr" instead of
              // "2x Kayak".
              activity = {
                minutes: it.quantity * 60,
                pricePerHour,
                running: false,
              };
            }
            items.push({
              name: it.menuItem?.name ?? "Deleted item",
              nameAr: it.menuItem?.nameAr ?? null,
              quantity: it.quantity,
              // Comped items print at 0 EGP so the guest sees the gesture
              // but isn't charged. Order.total was already re-summed
              // server-side excluding comped rows when the comp happened,
              // so the round subtotal is correct without further adjustment.
              price: unitPrice,
              addOns: it.addOns,
              notes: it.notes,
              comped: it.comped || undefined,
              activity,
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
          discount: Math.round(discount),
          serviceCharge: Math.round(serviceCharge),
          guestNumber,
          guestName,
        };
      });

    // Lifetime merge for the legacy `items` / `total` fields — kept so
    // older print code paths or consumers that don't know about rounds
    // still get something reasonable.
    const allItems: InvoiceItem[] = rounds.flatMap((r) => r.items);
    const subtotal = rounds.reduce((s, r) => s + r.subtotal, 0);
    const totalDiscount = rounds.reduce((s, r) => s + r.discount, 0);
    const totalServiceCharge = rounds.reduce((s, r) => s + r.serviceCharge, 0);
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
      discount: totalDiscount,
      serviceCharge: totalServiceCharge,
      total: subtotal - totalDiscount + totalServiceCharge,
      orderCount: session.orders.length,
      sessionId: session.id,
      rounds,
    });
  } catch (err) {
    console.error("Invoice fetch failed:", err);
    return NextResponse.json({ error: "Failed to fetch invoice" }, { status: 500 });
  }
}
