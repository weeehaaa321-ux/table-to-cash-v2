"use client";

import { memo } from "react";
import { useLanguage } from "@/lib/use-language";
import type { LiveOrder } from "./types";

function OrderTimelineImpl({ order }: { order: LiveOrder }) {
  const { t } = useLanguage();
  // Status progression \u2014 the bug this guards against: the live-data
  // mapper only sets `prepStartedAt` while `status === "preparing"`,
  // and clears it the moment the kitchen marks the order READY. So a
  // ready/served order would show "preparing" as unfilled (i.e. the
  // step was visibly skipped), even though the order obviously passed
  // through that state. Falling back to status order keeps the dot
  // filled once the order has reached or surpassed each step.
  const statusRank: Record<string, number> = {
    pending: 0,
    confirmed: 1,
    preparing: 2,
    ready: 3,
    served: 4,
    paid: 4,
    cancelled: -1,
  };
  const reached = statusRank[order.status] ?? 0;
  const steps = [
    { label: t("floor.ordered"), ts: order.createdAt, minRank: 1 },
    { label: t("floor.preparing"), ts: order.prepStartedAt, minRank: 2 },
    { label: t("floor.ready"), ts: order.readyAt, minRank: 3 },
    { label: t("floor.served"), ts: order.servedAt, minRank: 4 },
  ];
  return (
    <div className="flex items-center gap-0 mt-2">
      {steps.map((step, i) => {
        const filled = !!step.ts || reached >= step.minRank;
        const nextFilled =
          i < steps.length - 1 &&
          (!!steps[i + 1]?.ts || reached >= (steps[i + 1]?.minRank ?? Infinity));
        return (
          <div key={step.label} className="flex items-center flex-1">
            <div className="flex flex-col items-center">
              <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[8px] font-semibold ${
                filled ? "bg-ocean-600 text-white" : "bg-sand-200 text-text-muted"
              }`}>
                {filled ? "\u2713" : i + 1}
              </div>
              <span className="text-[8px] text-text-muted mt-0.5">{step.label}</span>
              {step.ts && <span className="text-[7px] text-text-muted">{new Date(step.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>}
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-0.5 mx-0.5 ${nextFilled ? "bg-ocean-400" : "bg-sand-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// Memoized: parent FloorManagerView re-renders on every poll;
// timeline only depends on `order` shape and changes when order
// status/timestamps change.
export const OrderTimeline = memo(OrderTimelineImpl);
