"use client";

import { motion } from "framer-motion";
import { useLanguage } from "@/lib/use-language";

export type TipsWaiterRow = {
  id: string;
  name: string;
  tips: number;
};

export type TipsCounterProps = {
  /** Total tips over the period the parent has loaded (typically today). */
  todayTips: number;
  /** Tips collected during the current shift (subset of todayTips). */
  shiftTips: number;
  /** Today's revenue, used to compute a tip rate next to the shift figure. */
  todayRevenue?: number;
  /** Per-waiter rows for the current shift, ranked highest → lowest. */
  waiters?: TipsWaiterRow[];
  /** Tighter padding/typography when this is rendered inside a sidebar. */
  compact?: boolean;
};

function formatEGP(n: number) {
  return Math.round(n).toLocaleString("en-EG");
}

function GiftIcon({ className }: { className?: string }) {
  // Hand-drawn gift glyph — a tiny visual cue that this card is about
  // tips/gratuity, not generic revenue. Uses currentColor so the parent
  // can recolour it.
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13" />
      <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
      <path d="M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8" />
      <path d="M16.5 8a2.5 2.5 0 0 0 0-5C13 3 12 8 12 8" />
    </svg>
  );
}

/**
 * Standalone tips counter card. Rendered in:
 *   - Cashier sidebar (next to CashierWallet)
 *   - Owner dashboard (a row on the overview tab)
 *
 * The hero number is **today's total tips**. The secondary metric is
 * **this shift's tips** plus a per-waiter breakdown so cashiers/owners
 * can see who's getting tipped (and remember to hand the cash to the
 * right person at end-of-shift).
 *
 * The empty state is intentional and friendly: "no tips yet today" with
 * a one-line hint, instead of a stark zero. Owners stare at this view
 * during slow stretches and we don't want it to look broken.
 */
export function TipsCounter({
  todayTips,
  shiftTips,
  todayRevenue,
  waiters = [],
  compact = false,
}: TipsCounterProps) {
  const { t } = useLanguage();
  const isEmpty = todayTips === 0;
  const tipRate =
    todayRevenue && todayRevenue > 0
      ? Math.round((todayTips / todayRevenue) * 1000) / 10
      : null;

  // Cap waiter rows so a busy day doesn't blow out a sidebar — the
  // top earners are what the cashier typically wants to see at a
  // glance; the books tab carries the full list if anyone needs it.
  const topWaiters = waiters
    .filter((w) => w.tips > 0)
    .sort((a, b) => b.tips - a.tips)
    .slice(0, compact ? 3 : 5);

  return (
    <motion.div
      className="rounded-2xl overflow-hidden shadow-lg relative"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      style={{
        background:
          "linear-gradient(135deg, #f59e0b 0%, #d97706 60%, #b45309 100%)",
      }}
    >
      {/* Soft sparkle glow in the corner — pure decoration. */}
      <div
        className="absolute -top-10 -end-10 w-40 h-40 rounded-full opacity-25 pointer-events-none"
        style={{ background: "radial-gradient(circle, #fde68a 0%, transparent 70%)" }}
      />
      <div className={`relative ${compact ? "p-4" : "p-5"} text-white`}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur flex items-center justify-center">
              <GiftIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-[10px] font-extrabold uppercase tracking-[0.2em] opacity-80">
                {t("tips.title")}
              </div>
              <div className="text-[11px] font-bold opacity-90">
                {t("tips.today")}
              </div>
            </div>
          </div>
          {tipRate != null && tipRate > 0 && (
            <div className="text-right">
              <div className="text-[10px] font-extrabold uppercase tracking-widest opacity-70">
                {tipRate.toFixed(1)}%
              </div>
              <div className="text-[9px] opacity-70">{t("tips.ofRevenue")}</div>
            </div>
          )}
        </div>

        {isEmpty ? (
          <div className="py-2">
            <div className={`${compact ? "text-2xl" : "text-3xl"} font-extrabold tabular-nums leading-none mb-1.5 opacity-90`}>
              0 <span className="text-sm font-bold opacity-70">EGP</span>
            </div>
            <p className="text-xs opacity-85 font-medium">{t("tips.empty")}</p>
            <p className="text-[10px] opacity-65 mt-0.5">{t("tips.emptyHint")}</p>
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-2 mb-3">
              <span className={`${compact ? "text-3xl" : "text-4xl"} font-extrabold tabular-nums tracking-tight leading-none`}>
                {formatEGP(todayTips)}
              </span>
              <span className="text-sm font-bold opacity-80">EGP</span>
            </div>
            <div className="bg-white/15 backdrop-blur rounded-xl px-3 py-2 flex items-center justify-between">
              <span className="text-[10px] font-extrabold uppercase tracking-widest opacity-90">
                {t("tips.thisShift")}
              </span>
              <span className="text-base font-extrabold tabular-nums">
                {formatEGP(shiftTips)}{" "}
                <span className="text-[10px] font-bold opacity-80">EGP</span>
              </span>
            </div>
          </>
        )}

        {/* Per-waiter breakdown — only when at least one tip happened.
            Keeps the empty state clean and avoids a "By waiter — none"
            row that just adds noise. */}
        {topWaiters.length > 0 && (
          <div className="mt-3 pt-3 border-t border-white/20">
            <div className="text-[10px] font-extrabold uppercase tracking-widest opacity-80 mb-1.5">
              {t("tips.byWaiter")}
            </div>
            <div className="space-y-1">
              {topWaiters.map((w) => (
                <div
                  key={w.id}
                  className="flex items-center justify-between text-xs font-bold"
                >
                  <span className="truncate opacity-90">{w.name}</span>
                  <span className="tabular-nums shrink-0 ms-2">
                    {formatEGP(w.tips)}{" "}
                    <span className="text-[10px] font-bold opacity-70">EGP</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
