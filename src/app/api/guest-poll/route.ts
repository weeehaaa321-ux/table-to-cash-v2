import { NextRequest, NextResponse } from "next/server";
import { useCases } from "@/infrastructure/composition";
import { toNum } from "@/lib/money";

/**
 * Bundled guest polling endpoint — returns everything a guest page needs in ONE call.
 * Replaces 3-5 separate polling loops with 1 request.
 *
 * Query params:
 *   sessionId    — the guest's session ID
 *   tableNumber  — table number
 *   restaurantId — restaurant slug or ID
 *   guestNumber  — for delegation check (optional)
 *   orderId      — specific order to track (optional)
 */

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get("sessionId");
  const restaurantParam = url.searchParams.get("restaurantId") || "";
  const orderId = url.searchParams.get("orderId");

  if (!sessionId || !restaurantParam) {
    return NextResponse.json({ error: "sessionId and restaurantId required" }, { status: 400 });
  }

  try {
    const realId = await useCases.sessions.resolveRestaurantId(restaurantParam);
    if (!realId) {
      return NextResponse.json({ session: null, orders: [], delegation: null, joinRequests: [] });
    }

    const [session, orders, delegation, joinRequests, singleOrder] =
      await useCases.livePoll.guestPollBundle({ sessionId, restaurantId: realId, orderId });

    // Merge split siblings (food + drinks from the same cart) into one
    // unified order for the guest. They never see the staff-side split.
    // Unified status = the least-advanced of the siblings (PREPARING
    // wins over SERVED so the guest sees "Preparing" until both halves
    // are done). CANCELLED siblings are excluded from the merge.
    type RawOrder = typeof orders[number];
    const STATUS_ORDER: Record<string, number> = {
      PENDING: 0, CONFIRMED: 1, PREPARING: 2, READY: 3, SERVED: 4, PAID: 5, CANCELLED: 99,
    };
    const minStatus = (a: string, b: string) =>
      (STATUS_ORDER[a] ?? 0) <= (STATUS_ORDER[b] ?? 0) ? a : b;

    const groups = new Map<string, RawOrder[]>();
    const solo: RawOrder[] = [];
    for (const o of orders) {
      if (o.groupId) {
        const bucket = groups.get(o.groupId) || [];
        bucket.push(o);
        groups.set(o.groupId, bucket);
      } else {
        solo.push(o);
      }
    }

    // Merged shape converts money fields to plain numbers so the
    // response serializes cleanly (Prisma.Decimal would JSON-stringify
    // as a string and break every client that does arithmetic).
    type MergedOrder = Omit<RawOrder, "total" | "deliveryFee"> & {
      total: number;
      deliveryFee: number;
    };

    const mergeGroup = (siblings: RawOrder[]): MergedOrder => {
      // Siblings are already sorted by createdAt desc by the outer
      // query. Pick the first as the representative; fold totals /
      // items / status across the rest.
      const live = siblings.filter((s) => s.status !== "CANCELLED");
      const base = live[0] ?? siblings[0];
      const baseStatus: string = live[0]?.status ?? base.status;
      const foldedStatus = live.reduce<string>(
        (acc, s) => minStatus(acc, s.status as string),
        baseStatus
      );
      const total = live.reduce((s, r) => s + toNum(r.total), 0);
      // Delivery fee lives on a single sibling (kitchen), but summing
      // across all live siblings gives the same answer and survives
      // future refactors that distribute the fee differently.
      const deliveryFee = live.reduce((s, r) => s + toNum(r.deliveryFee), 0);
      const items = live.flatMap((r) => r.items);
      const allPaid = live.length > 0 && live.every((s) => s.paidAt != null);
      const anyPending = live.find((s) => s.paymentMethod != null);
      return {
        ...base,
        status: foldedStatus as typeof base.status,
        total,
        deliveryFee,
        items,
        paidAt: allPaid ? (live[0].paidAt ?? base.paidAt) : null,
        paymentMethod: anyPending?.paymentMethod ?? null,
      };
    };

    const soloMerged: MergedOrder[] = solo.map((o) => ({
      ...o,
      total: toNum(o.total),
      deliveryFee: toNum(o.deliveryFee),
    }));

    const merged: MergedOrder[] = [
      ...soloMerged,
      ...Array.from(groups.values()).map(mergeGroup),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return NextResponse.json({
      session: session
        ? {
            id: session.id,
            status: session.status,
            guestCount: session.guestCount,
            tableNumber: session.table?.number ?? null,
          }
        : null,
      orders: merged.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        total: o.total,
        deliveryFee: o.deliveryFee,
        paymentMethod: o.paymentMethod || null,
        paidAt: o.paidAt ? o.paidAt.toISOString() : null,
        guestNumber: o.guestNumber ?? null,
        guestName: o.guestName ?? null,
        createdAt: o.createdAt.toISOString(),
        items: o.items.map((it) => ({
          name: it.menuItem?.name || "Item",
          quantity: it.quantity,
          price: toNum(it.price),
        })),
      })),
      delegation: delegation ? parseInt(delegation.command || "0", 10) : null,
      joinRequests: joinRequests.map((r) => ({ id: r.id, guestId: r.guestId })),
      trackedOrder: singleOrder
        ? {
            id: singleOrder.id,
            orderNumber: singleOrder.orderNumber,
            status: singleOrder.status,
            total: toNum(singleOrder.total),
            guestNumber: singleOrder.guestNumber ?? null,
            guestName: singleOrder.guestName ?? null,
            items: singleOrder.items.map((it) => ({
              name: it.menuItem?.name || "Item",
              quantity: it.quantity,
              price: toNum(it.price),
            })),
          }
        : null,
    });
  } catch (err) {
    console.error("guest-poll error:", err);
    return NextResponse.json({ session: null, orders: [], delegation: null, joinRequests: [] });
  }
}
