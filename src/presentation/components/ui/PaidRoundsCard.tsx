"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { downloadReceiptImage, type ReceiptRound } from "@/lib/receipt-image";

// Persistent "Your Receipt" card on the guest track page.
// Appears the moment round 1 is settled and stays visible across
// round 2/3/... tracking AND after the session closes. Exactly one
// Download button covers every round at once, so the guest never has
// to download per-round or guess which one includes what.
export function PaidRoundsCard({
  tableNumber,
  rounds,
  tip,
  lang,
}: {
  tableNumber: string | number;
  rounds: ReceiptRound[];
  tip: number;
  lang: "en" | "ar";
}) {
  const [expanded, setExpanded] = useState<number | null>(null);
  if (!rounds.length) return null;

  const allRoundsSubtotal = rounds.reduce((s, r) => s + r.subtotal, 0);
  const grandTotal = allRoundsSubtotal + tip;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl shadow-sm border border-sand-100 mb-4 overflow-hidden"
    >
      <div className="px-5 pt-4 pb-3 border-b border-sand-100">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-bold text-text-muted uppercase tracking-widest">
              {lang === "ar" ? "فاتورتك" : "Your Receipt"}
            </p>
            <p className="text-lg font-semibold text-text-primary tabular-nums">
              {grandTotal} EGP
            </p>
          </div>
          <span className="text-[10px] font-bold text-status-good-600 bg-status-good-50 border border-status-good-100 rounded-full px-2 py-0.5 uppercase tracking-wider">
            {rounds.length === 1
              ? lang === "ar" ? "جولة واحدة" : "1 round paid"
              : lang === "ar" ? `${rounds.length} جولات` : `${rounds.length} rounds paid`}
          </span>
        </div>
      </div>

      <div className="divide-y divide-sand-100">
        {rounds.map((r) => {
          const isOpen = expanded === r.index;
          return (
            <div key={r.index}>
              <button
                onClick={() => setExpanded(isOpen ? null : r.index)}
                className="w-full px-5 py-3 flex items-center justify-between hover:bg-sand-50 active:bg-sand-100 transition text-left"
              >
                <div className="flex items-center gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-sand-900 text-white text-[10px] font-semibold flex items-center justify-center">
                    {r.index}
                  </span>
                  <div>
                    <p className="text-xs font-bold text-text-primary">
                      {lang === "ar" ? `الجولة ${r.index}` : `Round ${r.index}`}
                    </p>
                    <p className="text-[10px] text-text-muted font-medium">
                      {r.orders.reduce((s, o) => s + o.items.reduce((n, it) => n + it.quantity, 0), 0)}{" "}
                      {lang === "ar" ? "عنصر" : "items"}
                      {r.paymentMethod ? `  ·  ${r.paymentMethod}` : ""}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-text-primary tabular-nums">
                    {r.subtotal} EGP
                  </span>
                  <motion.svg
                    animate={{ rotate: isOpen ? 180 : 0 }}
                    className="w-3.5 h-3.5 text-text-muted"
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                  </motion.svg>
                </div>
              </button>

              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-3 space-y-3 bg-sand-50/50">
                      {r.orders.map((o) => (
                        <div key={o.orderNumber} className="pt-2">
                          <p className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1">
                            {lang === "ar" ? `طلب #${o.orderNumber}` : `Order #${o.orderNumber}`}
                            {o.guestNumber && o.guestNumber > 0 ? `  ·  G${o.guestNumber}` : ""}
                          </p>
                          <div className="space-y-1">
                            {o.items.map((it, i) => (
                              <div key={i} className="flex justify-between text-xs">
                                <span className="text-text-secondary">
                                  <span className="font-semibold text-text-secondary me-1">{it.quantity}×</span>
                                  {it.name || "Item"}
                                </span>
                                <span className="text-text-secondary tabular-nums">
                                  {it.price * it.quantity} EGP
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      <div className="px-5 py-3 bg-sand-50/50 border-t border-sand-100">
        {tip > 0 && (
          <div className="flex justify-between text-xs text-text-secondary mb-1">
            <span>{lang === "ar" ? "البقشيش" : "Tip"}</span>
            <span className="tabular-nums">{tip} EGP</span>
          </div>
        )}
        {rounds.length > 1 && (
          <div className="flex justify-between text-xs text-text-secondary mb-1">
            <span>{lang === "ar" ? "مجموع الجولات" : "All rounds"}</span>
            <span className="tabular-nums">{allRoundsSubtotal} EGP</span>
          </div>
        )}
        <div className="flex justify-between items-baseline pt-1 border-t border-sand-100 mt-1">
          <span className="text-xs font-semibold text-text-primary">
            {lang === "ar" ? "الإجمالي" : "Grand Total"}
          </span>
          <span className="text-base font-semibold text-status-good-600 tabular-nums">
            {grandTotal} EGP
          </span>
        </div>
        <button
          onClick={() =>
            downloadReceiptImage({
              tableNumber,
              rounds,
              tip,
              grandTotal,
              lang,
            })
          }
          className="mt-3 w-full py-2.5 rounded-xl bg-sand-900 text-white text-xs font-bold flex items-center justify-center gap-2 active:bg-sand-800"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          {lang === "ar" ? "تحميل الفاتورة" : "Download Receipt"}
        </button>
      </div>
    </motion.div>
  );
}

// Derive rounds from the flat session order list. The cashier PATCH
// stamps the same `new Date()` on every order in one batch, so orders
// that share an identical paidAt belong to the same round. Cancelled
// orders and never-settled ones are excluded.
export function computePaidRounds(
  orders: {
    id: string;
    orderNumber: number;
    total: number;
    guestNumber?: number | null;
    paidAt?: string | null;
    paymentMethod?: string | null;
    status?: string;
    items: { name: string; quantity: number; price: number }[];
  }[]
): ReceiptRound[] {
  const paid = orders.filter((o) => o.paidAt && o.status !== "cancelled");
  const buckets = new Map<string, typeof paid>();
  for (const o of paid) {
    const key = o.paidAt!;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(o);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([paidAt, group], i) => ({
      index: i + 1,
      paidAt,
      paymentMethod: group[0].paymentMethod ?? null,
      orders: group.map((o) => ({
        orderNumber: o.orderNumber,
        total: o.total,
        guestNumber: o.guestNumber ?? null,
        items: o.items,
      })),
      subtotal: group.reduce((s, o) => s + o.total, 0),
    }));
}
