// Group a session's orders into "rounds" — one round per distinct paidAt
// timestamp. The cashier PATCH stamps every order in a batch with the
// same `new Date()`, so identical paidAt = one settlement event.
//
// Both /api/live-snapshot and /api/sessions/all return this shape so the
// cashier can show "Paid so far: 200 CASH · 150 CARD" and label the next
// confirmation as "Round N".

export type SessionRound = {
  index: number;
  paidAt: string;
  paymentMethod: string | null;
  subtotal: number;
  orderCount: number;
  guestNumber: number | null;
  guestName: string | null;
};

export function computeSessionRounds(
  orders: {
    total: number;
    status: string;
    paymentMethod: string | null;
    paidAt: Date | null;
    guestNumber?: number | null;
    guestName?: string | null;
  }[]
): SessionRound[] {
  const paid = orders.filter((o) => o.paidAt && o.status !== "CANCELLED");
  const buckets = new Map<string, typeof paid>();
  for (const o of paid) {
    const key = o.paidAt!.toISOString();
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(o);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([paidAt, group], i) => ({
      index: i + 1,
      paidAt,
      paymentMethod: group[0].paymentMethod ?? null,
      subtotal: Math.round(group.reduce((s, o) => s + o.total, 0)),
      orderCount: group.length,
      guestNumber: group.find((o) => o.guestNumber != null)?.guestNumber ?? null,
      guestName: group.find((o) => o.guestName)?.guestName ?? null,
    }));
}
