"use client";

import { useState } from "react";
import { useLanguage } from "@/lib/use-language";
import { minsAgo } from "./constants";

// Stuck-at-gate panel: when a session owner is away (pool, sea, phone
// in a pocket), their friends scanning the table's QR get queued as
// PENDING JoinRequests. The owner's JoinRequestOverlay is the normal
// approval path — but if no one looks at the owner's phone, the
// guest waits at the table doing nothing. This panel surfaces every
// pending request to the floor manager so they can admit anyone in
// directly.
//
// Renders nothing when there are no pending requests, so the banner
// only steals screen real estate when it actually matters.
export function JoinGatePanel({
  requests,
  onAdmit,
  onReject,
}: {
  requests: {
    id: string;
    sessionId: string;
    createdAt: string;
    tableNumber: number | null;
    vipGuestName: string | null;
    orderType: string;
    guestCount: number;
  }[];
  onAdmit: (requestId: string) => Promise<{ ok: boolean; message?: string }>;
  onReject: (requestId: string) => Promise<{ ok: boolean; message?: string }>;
}) {
  const { t } = useLanguage();
  const [busyId, setBusyId] = useState<string | null>(null);

  if (requests.length === 0) return null;

  return (
    <div className="rounded-2xl bg-status-warn-50 border-2 border-status-warn-300 overflow-hidden">
      <div className="px-4 py-3 border-b border-status-warn-200 flex items-center gap-2">
        <span className="text-lg">🚪</span>
        <div className="flex-1">
          <h3 className="text-sm font-bold text-status-warn-900 uppercase tracking-wide">
            {t("floor.joinGate.title")}
          </h3>
          <p className="text-[10px] text-status-warn-700 font-semibold">
            {requests.length} {requests.length === 1 ? t("floor.joinGate.guestWaiting") : t("floor.joinGate.guestsWaiting")}
          </p>
        </div>
      </div>
      <div className="divide-y divide-status-warn-200/60">
        {requests.map((r) => {
          const wait = minsAgo(new Date(r.createdAt).getTime());
          const tableLabel = r.tableNumber != null
            ? `${t("common.table")} ${r.tableNumber}`
            : r.vipGuestName || "VIP";
          return (
            <div key={r.id} className="px-4 py-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-status-warn-200 flex items-center justify-center text-sm font-bold text-status-warn-800 shrink-0">
                  {r.tableNumber ?? "V"}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-status-warn-900 truncate">{tableLabel}</p>
                  <p className="text-[11px] text-status-warn-700 font-semibold tabular-nums">
                    {wait > 0 ? `${wait} ${t("common.minutes")} ${t("floor.joinGate.waiting")}` : t("floor.joinGate.justArrived")}
                    {r.guestCount > 0 ? ` · ${r.guestCount} ${r.guestCount !== 1 ? t("common.guests") : t("common.guest")}` : ""}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  disabled={busyId !== null}
                  onClick={async () => {
                    setBusyId(r.id);
                    await onReject(r.id);
                    setBusyId(null);
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-white text-status-bad-600 border border-status-bad-200 text-[11px] font-bold active:scale-95 hover:bg-status-bad-50 disabled:opacity-50"
                >
                  {t("floor.joinGate.reject")}
                </button>
                <button
                  disabled={busyId !== null}
                  onClick={async () => {
                    setBusyId(r.id);
                    await onAdmit(r.id);
                    setBusyId(null);
                  }}
                  className="px-3 py-1.5 rounded-lg bg-status-good-600 text-white text-[11px] font-bold active:scale-95 hover:bg-status-good-700 disabled:opacity-50"
                >
                  {busyId === r.id ? "…" : t("floor.joinGate.admit")}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
