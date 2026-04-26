import { Money, sumMoney } from "../shared/Money";
import type { Order } from "../order/Order";
import type { PaymentMethod } from "../order/enums";

/**
 * SessionRound — read model derived from a TableSession's Orders.
 *
 * Source repo concept: a "round" is a paid-or-being-paid batch of
 * orders within one session. A session may have multiple rounds when
 * a group splits the bill mid-meal, or pays for drinks now and food
 * later. The DB stores Orders directly with a `paidAt` and
 * `paymentMethod`; rounds are computed by grouping consecutive orders
 * by their paidAt + paymentMethod.
 *
 * This is a pure value type — not stored. Computed by
 * `groupOrdersIntoRounds()` and used by:
 *   - the cashier UI ("show me what's owed for this round")
 *   - the print agent (multi-round receipts show prior rounds)
 *   - the daily-close totals (sum revenue by paymentMethod)
 */
export type SessionRound = {
  index: number; // 1-based display index
  paymentMethod: PaymentMethod | null;
  paidAt: Date | null;
  subtotal: Money;
  tax: Money;
  tip: Money;
  deliveryFee: Money;
  total: Money;
  items: ReadonlyArray<{ name: string; quantity: number; price: Money }>;
};

/**
 * Group a session's orders into rounds. Logic mirrors source repo's
 * print-agent and cashier session view:
 *   - all unpaid orders form one open round (the current bill)
 *   - each paid order is its own round (or grouped by paidAt+method
 *     if submitted as a batch)
 *
 * Rounds are returned in chronological order.
 */
export function groupOrdersIntoRounds(
  orders: readonly Order[],
  itemNameLookup: (orderItemId: string) => string,
): readonly SessionRound[] {
  if (orders.length === 0) return [];
  const sorted = [...orders].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );

  // Group key: "unpaid" or "<paidAtISO>|<method>" so a batch settled
  // together is one round.
  type Bucket = { key: string; orders: Order[] };
  const buckets: Bucket[] = [];
  for (const o of sorted) {
    const key = o.paidAt
      ? `${o.paidAt.toISOString()}|${o.paymentMethod ?? "?"}`
      : "unpaid";
    let bucket = buckets[buckets.length - 1];
    if (!bucket || bucket.key !== key) {
      bucket = { key, orders: [] };
      buckets.push(bucket);
    }
    bucket.orders.push(o);
  }

  return buckets.map((bucket, i) => {
    const orders = bucket.orders;
    const subtotal = sumMoney(orders.map((o) => o.subtotal));
    const tax = sumMoney(orders.map((o) => o.tax));
    const tip = sumMoney(orders.map((o) => o.tip));
    const deliveryFee = sumMoney(orders.map((o) => o.deliveryFee));
    const total = sumMoney(orders.map((o) => o.total));
    const flatItems = orders.flatMap((o) =>
      o.items
        .filter((it) => !it.cancelled && !it.comped)
        .map((it) => ({
          name: itemNameLookup(it.id),
          quantity: it.quantity,
          price: it.priceAtOrder,
        })),
    );
    return {
      index: i + 1,
      paymentMethod: orders[0].paymentMethod,
      paidAt: orders[0].paidAt,
      subtotal,
      tax,
      tip,
      deliveryFee,
      total,
      items: flatItems,
    };
  });
}
