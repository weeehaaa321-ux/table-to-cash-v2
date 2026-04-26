"use client";

import { useLanguage } from "@/lib/use-language";
import type { LiveOrder } from "./types";

export function OrderTimeline({ order }: { order: LiveOrder }) {
  const { t } = useLanguage();
  const steps = [
    { label: t("floor.ordered"), ts: order.createdAt },
    { label: t("floor.preparing"), ts: order.prepStartedAt },
    { label: t("floor.ready"), ts: order.readyAt },
    { label: t("floor.served"), ts: order.servedAt },
  ];
  return (
    <div className="flex items-center gap-0 mt-2">
      {steps.map((step, i) => {
        const filled = !!step.ts;
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
              <div className={`flex-1 h-0.5 mx-0.5 ${steps[i + 1]?.ts ? "bg-ocean-400" : "bg-sand-200"}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}
