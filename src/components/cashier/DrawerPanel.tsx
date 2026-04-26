"use client";

import { useCallback, useEffect, useState } from "react";
import { staffFetch } from "@/lib/staff-fetch";

// ═══════════════════════════════════════════════════════
// DRAWER PANEL — Cashier opens/closes the cash drawer.
//
// Open state: cashier enters opening float, server creates a CashDrawer
// row. While open, the panel shows a running "expected cash" total.
// Close: cashier types the physical count, server computes variance
// and persists it. One open drawer per cashier at a time.
// ═══════════════════════════════════════════════════════

type Drawer = {
  id: string;
  openedAt: string;
  openingFloat: number;
  cashSince: number;
  expectedSoFar: number;
};

export function DrawerPanel({ restaurantId, cashierId }: { restaurantId: string; cashierId: string }) {
  const [drawer, setDrawer] = useState<Drawer | null>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [closing, setClosing] = useState(false);
  const [openInput, setOpenInput] = useState("");
  const [closeInput, setCloseInput] = useState("");
  const [notesInput, setNotesInput] = useState("");
  const [closeResult, setCloseResult] = useState<{ expected: number; count: number; variance: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await staffFetch(cashierId, `/api/drawer?restaurantId=${encodeURIComponent(restaurantId)}&cashierId=${encodeURIComponent(cashierId)}`);
      if (!res.ok) return;
      const json = await res.json();
      setDrawer(json.drawer || null);
    } catch {
      /* silent — a failed drawer poll shouldn't break cashier */
    } finally {
      setLoading(false);
    }
  }, [restaurantId, cashierId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const handleOpen = async () => {
    const float = Math.max(0, Math.round(Number(openInput) || 0));
    if (!isFinite(float)) return;
    setOpening(true);
    setError(null);
    try {
      const res = await staffFetch(cashierId, "/api/drawer", {
        method: "POST",
        body: JSON.stringify({ restaurantId, cashierId, openingFloat: float }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.message || json.error || "Failed to open drawer");
        return;
      }
      setOpenInput("");
      await load();
    } finally {
      setOpening(false);
    }
  };

  const handleClose = async () => {
    if (!drawer) return;
    const count = Math.max(0, Math.round(Number(closeInput) || 0));
    if (!isFinite(count)) return;
    setClosing(true);
    setError(null);
    try {
      const res = await staffFetch(cashierId, "/api/drawer", {
        method: "PATCH",
        body: JSON.stringify({ drawerId: drawer.id, closingCount: count, notes: notesInput }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.message || json.error || "Failed to close drawer");
        return;
      }
      setCloseResult({ expected: json.drawer.expectedCash, count: json.drawer.closingCount, variance: json.drawer.variance });
      setCloseInput("");
      setNotesInput("");
      await load();
    } finally {
      setClosing(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl bg-white border border-sand-200 p-4">
        <div className="h-4 w-24 bg-sand-100 rounded animate-pulse" />
      </div>
    );
  }

  // Close receipt — show briefly after a close completes.
  if (closeResult) {
    const short = closeResult.variance < 0;
    return (
      <div className={`rounded-2xl p-4 border-2 ${short ? "bg-status-bad-50 border-status-bad-300" : closeResult.variance > 0 ? "bg-status-warn-50 border-status-warn-300" : "bg-status-good-50 border-status-good-300"}`}>
        <div className="flex items-center justify-between mb-2">
          <p className={`text-sm font-semibold ${short ? "text-status-bad-800" : closeResult.variance > 0 ? "text-status-warn-800" : "text-status-good-800"}`}>
            Drawer closed
          </p>
          <button onClick={() => setCloseResult(null)} className="text-xs font-bold text-text-secondary hover:text-text-primary">Dismiss</button>
        </div>
        <div className="text-xs font-semibold text-text-secondary space-y-0.5">
          <div className="flex justify-between"><span>Expected</span><span className="tabular-nums">{closeResult.expected} EGP</span></div>
          <div className="flex justify-between"><span>Counted</span><span className="tabular-nums">{closeResult.count} EGP</span></div>
          <div className={`flex justify-between font-semibold ${short ? "text-status-bad-700" : closeResult.variance > 0 ? "text-status-warn-700" : "text-status-good-700"}`}>
            <span>Variance</span>
            <span className="tabular-nums">{closeResult.variance > 0 ? "+" : ""}{closeResult.variance} EGP</span>
          </div>
        </div>
      </div>
    );
  }

  if (!drawer) {
    return (
      <div className="rounded-2xl bg-white border-2 border-sand-200 p-4">
        <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-2">Cash drawer</p>
        <p className="text-sm font-semibold text-text-secondary mb-3">
          Closed. Count your opening float and open the drawer to start tracking cash.
        </p>
        <div className="flex gap-2">
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={openInput}
            onChange={(e) => setOpenInput(e.target.value)}
            placeholder="Opening float (EGP)"
            className="flex-1 px-3 py-2 rounded-xl border-2 border-sand-200 text-sm font-semibold focus:border-status-wait-500 focus:outline-none"
          />
          <button
            onClick={handleOpen}
            disabled={opening || !openInput}
            className="px-4 py-2 rounded-xl bg-status-wait-600 text-white text-sm font-semibold active:scale-95 disabled:opacity-50"
          >
            {opening ? "…" : "Open"}
          </button>
        </div>
        {error && <p className="mt-2 text-[11px] font-bold text-status-bad-600">{error}</p>}
      </div>
    );
  }

  const openedTime = new Date(drawer.openedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="rounded-2xl bg-white border-2 border-status-good-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-status-good-600 uppercase tracking-wide">Cash drawer · open</p>
        <span className="text-[11px] font-bold text-text-secondary">since {openedTime}</span>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3 text-center">
        <div>
          <p className="text-[10px] font-bold text-text-secondary uppercase">Opening</p>
          <p className="text-sm font-semibold text-text-primary tabular-nums">{drawer.openingFloat}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold text-text-secondary uppercase">Cash in</p>
          <p className="text-sm font-semibold text-status-good-700 tabular-nums">{drawer.cashSince}</p>
        </div>
        <div>
          <p className="text-[10px] font-bold text-text-secondary uppercase">Expected</p>
          <p className="text-sm font-semibold text-status-wait-700 tabular-nums">{drawer.expectedSoFar}</p>
        </div>
      </div>
      <div className="space-y-2">
        <input
          type="number"
          min={0}
          inputMode="numeric"
          value={closeInput}
          onChange={(e) => setCloseInput(e.target.value)}
          placeholder="Physical count (EGP)"
          className="w-full px-3 py-2 rounded-xl border-2 border-sand-200 text-sm font-semibold focus:border-status-bad-500 focus:outline-none"
        />
        <input
          type="text"
          value={notesInput}
          onChange={(e) => setNotesInput(e.target.value)}
          placeholder="Notes (optional)"
          className="w-full px-3 py-2 rounded-xl border-2 border-sand-200 text-xs font-semibold focus:border-status-bad-500 focus:outline-none"
        />
        <button
          onClick={handleClose}
          disabled={closing || !closeInput}
          className="w-full px-4 py-2 rounded-xl bg-status-bad-600 text-white text-sm font-semibold active:scale-95 disabled:opacity-50"
        >
          {closing ? "Closing…" : "Close drawer"}
        </button>
      </div>
      {error && <p className="mt-2 text-[11px] font-bold text-status-bad-600">{error}</p>}
    </div>
  );
}
