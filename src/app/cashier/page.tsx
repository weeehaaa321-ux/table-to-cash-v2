"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLanguage } from "@/lib/use-language";
import { LanguageToggle } from "@/presentation/components/ui/LanguageToggle";
import { getShiftTimer, getShiftLabel, getCurrentShift } from "@/lib/shifts";
import SchedulePopup from "@/presentation/components/ui/SchedulePopup";
import { ClockButton } from "@/presentation/components/ui/ClockButton";
import { requestNotificationPermission } from "@/lib/notifications";
import { startPoll } from "@/lib/polling";
import { useCashierReliability } from "@/lib/use-cashier-reliability";
import { getOrderLabel } from "@/lib/order-label";
import { staffFetch } from "@/lib/staff-fetch";
import { DrawerPanel } from "@/presentation/components/cashier/DrawerPanel";
import { TipsCounter } from "@/presentation/components/ui/TipsCounter";

// ═══════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════

type LoggedInStaff = { id: string; name: string; role: string; shift: number };

type PaidRoundInfo = {
  index: number;
  paidAt: string;
  paymentMethod: string | null;
  subtotal: number;
  orderCount: number;
  guestNumber?: number | null;
  guestName?: string | null;
};

type SessionInfo = {
  id: string;
  tableNumber: number | null;
  orderType?: string;
  vipGuestName?: string | null;
  guestCount: number;
  waiterId?: string;
  waiterName?: string;
  status: string;
  orderTotal?: number;
  // What the cashier still needs to collect on this session. Excludes
  // any order already settled in a prior round, so follow-up orders
  // after a first-round payment are charged as a delta, not re-added
  // on top of the gross total.
  unpaidTotal?: number;
  cashTotal?: number;
  paymentReceived?: boolean;
  // Settlement history — one entry per prior paidAt. Drives the
  // "Paid so far: 200 CASH · 150 CARD" strip and round labels on
  // the confirm modal and buttons. Empty on first-time payers.
  paidRounds?: PaidRoundInfo[];
  // What the guest chose on /track when they tapped "Pay X EGP".
  // Surfaced so the cashier sees and reconciles the same method —
  // the chosen method is highlighted and the rest dimmed, instead
  // of asking the guest "did you pick cash or card?" again.
  pendingPaymentMethod?: "CASH" | "CARD" | "INSTAPAY" | null;
  // The tip the guest selected on /track. Pre-fills the cashier's
  // tip input so the cashier doesn't type it from scratch (and
  // doesn't accidentally drop it).
  pendingTip?: number;
  // Round-scoped total: sum of orders the guest already signalled
  // they're paying for (paymentMethod stamped, paidAt null). When
  // > 0, that's what the cashier collects in this round — NOT the
  // full session unpaidTotal. Drives split-pay UX without forcing
  // the cashier to do any picking themselves.
  pendingTotal?: number;
  // Flat list of items the cashier is about to collect on (every
  // unpaid, non-cancelled, non-comped line across the session's
  // open orders). Rendered inline on the open-bill card so the
  // cashier can see what's being charged, not just the total.
  // The `pending` flag marks items belonging to the in-flight
  // round (a guest-signalled split); when ANY item is pending the
  // card narrows the breakdown to just those items.
  unpaidItems?: {
    id: string;
    orderId: string;
    name: string;
    nameAr: string | null;
    quantity: number;
    price: number;
    addOns: string[];
    notes: string | null;
    pending: boolean;
  }[];
};


// ═══════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════

function formatEGP(n: number): string {
  return Math.round(n).toLocaleString("en-EG");
}

// Flatten a session's past settlements into "200 CASH · 150 CARD".
// Used under open-bill rows and inside the confirm modal so the cashier
// knows at a glance what this table has already paid before deciding
// how much to collect this round.
function summarizePriorRounds(rounds: { paymentMethod: string | null; subtotal: number }[]): string | null {
  if (!rounds.length) return null;
  const byMethod = new Map<string, number>();
  for (const r of rounds) {
    const key = (r.paymentMethod || "OTHER").toUpperCase();
    byMethod.set(key, (byMethod.get(key) ?? 0) + r.subtotal);
  }
  return Array.from(byMethod.entries())
    .map(([m, amt]) => `${formatEGP(amt)} ${m}`)
    .join(" · ");
}

function minsAgo(ts: string | number): number {
  const t = typeof ts === "string" ? new Date(ts).getTime() : ts;
  return Math.max(0, Math.round((Date.now() - t) / 60000));
}

type InvoiceItem = { name: string; nameAr: string | null; quantity: number; price: number; addOns: string[]; notes: string | null };
type InvoiceRound = {
  index: number;
  paidAt: string;
  paymentMethod: string | null;
  items: InvoiceItem[];
  subtotal: number;
  guestNumber?: number | null;
  guestName?: string | null;
};
type InvoiceData = {
  restaurantName: string;
  currency: string;
  tableNumber: number | null;
  orderType?: string;
  vipGuestName?: string | null;
  guestCount: number;
  waiterName: string | null;
  openedAt: string;
  closedAt: string | null;
  paymentMethod: string | null;
  items: InvoiceItem[];
  subtotal: number;
  total: number;
  orderCount: number;
  sessionId: string;
  rounds: InvoiceRound[];
};

async function fetchInvoice(sessionId: string, staffId?: string): Promise<InvoiceData | null> {
  try {
    const headers: Record<string, string> = {};
    if (staffId) headers["x-staff-id"] = staffId;
    const res = await fetch(`/api/invoice?sessionId=${sessionId}`, { headers });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

// Try the local print agent (scripts/print-agent.mjs) for silent
// thermal printing; fall back to the browser print dialog if the
// agent isn't running. The cashier sets the agent URL via
// localStorage.cashier_print_agent (default http://localhost:9911).
//
// Returns a structured outcome instead of a bare boolean — the
// cashier UI surfaces this so the operator knows when receipts
// silently failed to print (paper out, agent down, etc). The old
// "fire and forget, popup window as fallback" path was the bug
// behind "30 cash payments confirmed, no receipts printed all
// night, discovered next morning at cash-up".
type PrintAgentOutcome = {
  ok: boolean;
  reason?: "paper_out" | "printer_unreachable" | "agent_unreachable" | "agent_error" | "unknown";
  paperLow?: boolean;
};

async function tryAgentPrint(sessionId: string): Promise<PrintAgentOutcome> {
  const agentUrl =
    (typeof localStorage !== "undefined" && localStorage.getItem("cashier_print_agent")) ||
    "http://localhost:9911";
  try {
    const res = await fetch(`${agentUrl}/print`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      return {
        ok: false,
        reason: (json.reason as PrintAgentOutcome["reason"]) || "unknown",
      };
    }
    return { ok: true, paperLow: !!json.paperLow };
  } catch {
    // Most often: agent process not running on the cashier PC.
    return { ok: false, reason: "agent_unreachable" };
  }
}

async function probeAgentHealth(): Promise<PrintAgentOutcome> {
  const agentUrl =
    (typeof localStorage !== "undefined" && localStorage.getItem("cashier_print_agent")) ||
    "http://localhost:9911";
  try {
    const res = await fetch(`${agentUrl}/health`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.ok) {
      // Agent ran the probe and reported a problem (paperOut /
      // printer_unreachable / etc).
      const reason = json.error === "unreachable"
        ? "printer_unreachable"
        : json.paperOut
          ? "paper_out"
          : "unknown";
      return { ok: false, reason: reason as PrintAgentOutcome["reason"] };
    }
    return { ok: true, paperLow: !!json.paperLow };
  } catch {
    return { ok: false, reason: "agent_unreachable" };
  }
}

// Returns true if the print window opened (popup wasn't blocked); false
// if the browser refused (popup blocker is the most common cause).
function printInvoice(inv: InvoiceData): boolean {
  // RECEIPT POLICY: print order items + their TOTAL only. Never show a
  // tip line. Tip is a private cashier↔guest matter and stays in the
  // app; the printed paper is for the customer's records of what they
  // ordered. The TOTAL below is `current.subtotal` which is sum of
  // Order.total — already excludes tip by design.
  const rounds = inv.rounds || [];
  // The receipt prints at the moment of settlement — so the "current"
  // round is always the most recent one. Older rounds fold into a
  // "Previously paid" footer so the paper shows both what the cashier
  // just collected AND what the table has paid lifetime.
  const current = rounds[rounds.length - 1];
  const prior = rounds.slice(0, -1);

  const date = new Date(current?.paidAt || inv.closedAt || inv.openedAt);
  const dateStr = date.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
  const timeStr = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  const escapeHtml = (s: string) =>
    s.replace(/[&<>"']/g, (ch) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[ch] as string));

  // One language per row, consistently across all items. Some menu
  // items have nameAr filled in and some don't, so the previous
  // "English + Arabic when available" branch printed bilingual rows
  // for half the order and English-only rows for the other half —
  // looked like a bug. Stick to the canonical English `name` field;
  // the bottom-of-receipt thank-you line carries the Arabic touch.
  const renderItemRows = (items: InvoiceItem[]) =>
    items.map((item) => {
      const line = `${item.quantity}x ${escapeHtml(item.name)}`;
      const price = `${Math.round(item.price * item.quantity)}`;
      const addOns = item.addOns.length > 0 ? item.addOns.map((a) => { try { const p = JSON.parse(a); return p.name || a; } catch { return a; } }).join(", ") : "";
      return `
      <tr>
        <td style="text-align:left;padding:2px 0;font-size:12px;">${line}${addOns ? `<br><span style="font-size:10px;color:#666;">  + ${escapeHtml(addOns)}</span>` : ""}${item.notes ? `<br><span style="font-size:10px;color:#666;">  "${escapeHtml(item.notes)}"</span>` : ""}</td>
        <td style="text-align:right;padding:2px 0;font-size:12px;white-space:nowrap;">${price}</td>
      </tr>`;
    }).join("");

  const currentItems = current?.items ?? inv.items;
  const currentSubtotal = current?.subtotal ?? inv.total;
  const currentMethod = current?.paymentMethod ?? inv.paymentMethod;
  // Per-round guest label — name when the guest entered one at scan
  // time, fall back to "Guest N", or empty when neither is known
  // (walk-in/owner-only). Stays on the printed paper alongside the
  // payment method so a cashier with multiple rounds can match each
  // receipt back to which guest paid for it.
  const guestLabelFor = (r: { guestName?: string | null; guestNumber?: number | null } | undefined): string => {
    if (!r) return "";
    if (r.guestName && r.guestName.trim()) return r.guestName.trim();
    if (r.guestNumber && r.guestNumber > 0) return `Guest ${r.guestNumber}`;
    return "";
  };
  const currentGuest = guestLabelFor(current);

  const isMultiRound = rounds.length > 1;
  const roundLabel = isMultiRound
    ? `ROUND ${current?.index ?? rounds.length} OF ${rounds.length}`
    : "";

  const priorBlock = prior.length > 0 ? `
  <div class="divider"></div>
  <div style="font-size:10px;color:#444;margin:4px 0 2px;"><b>Previously paid on this table:</b></div>
  <table>
    ${prior.map((r) => {
      const g = guestLabelFor(r);
      const meta = [r.paymentMethod, g].filter(Boolean).join(" · ");
      return `
      <tr>
        <td style="font-size:11px;text-align:left;padding:1px 0;">Round ${r.index}${meta ? ` · ${escapeHtml(meta)}` : ""}</td>
        <td style="font-size:11px;text-align:right;padding:1px 0;">${r.subtotal} ${inv.currency}</td>
      </tr>`;
    }).join("")}
    <tr>
      <td style="font-size:11px;text-align:left;padding-top:3px;border-top:1px dashed #999;"><b>Lifetime total</b></td>
      <td style="font-size:11px;text-align:right;padding-top:3px;border-top:1px dashed #999;"><b>${inv.total} ${inv.currency}</b></td>
    </tr>
  </table>
  ` : "";

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Invoice - ${inv.tableNumber != null ? `Table ${inv.tableNumber}` : (inv.vipGuestName || "VIP")}${isMultiRound ? ` · R${current?.index}` : ""}</title>
  <style>
    @media print {
      @page { margin: 5mm; size: 80mm auto; }
      body { margin: 0; }
    }
    body { font-family: 'Courier New', monospace; width: 72mm; margin: 0 auto; padding: 5mm; color: #000; }
    .center { text-align: center; }
    .bold { font-weight: bold; }
    .divider { border-top: 1px dashed #000; margin: 6px 0; }
    .round-banner { background: #000; color: #fff; text-align: center; font-weight: bold; padding: 4px 0; margin: 6px 0; font-size: 12px; letter-spacing: 1px; }
    table { width: 100%; border-collapse: collapse; }
    .total-row td { font-weight: bold; font-size: 14px; padding-top: 4px; }
  </style>
</head>
<body>
  <div class="center bold" style="font-size:16px;margin-bottom:2px;">${inv.restaurantName}</div>
  <div class="divider"></div>

  <div style="font-size:11px;margin:4px 0;">
    <div><b>${inv.tableNumber != null ? `Table:</b> ${inv.tableNumber}` : `Guest:</b> ${inv.vipGuestName || "VIP"}`}${inv.guestCount > 0 ? ` &nbsp; <b>Guests:</b> ${inv.guestCount}` : ""}</div>
    ${inv.waiterName ? `<div><b>Server:</b> ${inv.waiterName}</div>` : ""}
    <div><b>Date:</b> ${dateStr} ${timeStr}</div>
    <div><b>Invoice:</b> ${inv.sessionId.slice(-8).toUpperCase()}${isMultiRound ? `-R${current?.index}` : ""}</div>
  </div>

  ${roundLabel ? `<div class="round-banner">${roundLabel}</div>` : `<div class="divider"></div>`}

  <table>
    <thead>
      <tr style="font-size:11px;font-weight:bold;border-bottom:1px solid #000;">
        <td style="text-align:left;padding-bottom:3px;">Item</td>
        <td style="text-align:right;padding-bottom:3px;">${inv.currency}</td>
      </tr>
    </thead>
    <tbody>
      ${renderItemRows(currentItems)}
    </tbody>
  </table>

  <div class="divider"></div>

  <table>
    <tr class="total-row">
      <td style="text-align:left;">${isMultiRound ? "THIS ROUND" : "TOTAL"}</td>
      <td style="text-align:right;">${currentSubtotal} ${inv.currency}</td>
    </tr>
    ${currentMethod ? `<tr><td style="font-size:11px;text-align:left;padding-top:4px;">Paid by</td><td style="font-size:11px;text-align:right;padding-top:4px;">${currentMethod}</td></tr>` : ""}
    ${currentGuest ? `<tr><td style="font-size:11px;text-align:left;padding-top:2px;">Guest</td><td style="font-size:11px;text-align:right;padding-top:2px;">${escapeHtml(currentGuest)}</td></tr>` : ""}
  </table>

  ${priorBlock}

  <div class="divider"></div>

  <div class="center" style="font-size:11px;margin-top:6px;">
    Thank you for dining with us!<br>
    <span style="font-size:10px;color:#666;">شكراً لزيارتكم</span>
  </div>

  <script>window.onload = function() { window.print(); }</script>
</body>
</html>`;

  const win = window.open("", "_blank", "width=350,height=600");
  if (!win) {
    // Browser blocked the popup — caller surfaces this so the
    // cashier knows to reprint manually instead of silently
    // moving on with no paper trail.
    return false;
  }
  win.document.write(html);
  win.document.close();
  return true;
}

// ═══════════════════════════════════════════════
// CASHIER LOGIN (reuses staff PIN system)
// ═══════════════════════════════════════════════

function CashierLogin({ onLogin }: { onLogin: (staff: LoggedInStaff) => void }) {
  const { t } = useLanguage();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const restaurantSlug = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";

  const handleSubmit = async () => {
    if (pin.length < 4) { setError(t("login.pinTooShort")); return; }
    setError(""); setLoading(true);
    try {
      const res = await fetch("/api/staff/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, restaurantId: restaurantSlug }),
      });
      if (!res.ok) { const data = await res.json(); setError(data.error || t("login.invalidPin")); setLoading(false); return; }
      const staff = await res.json();
      if (staff.role !== "CASHIER") { setError(t("cashier.notCashierPin")); setLoading(false); return; }
      onLogin(staff);
    } catch { setError(t("login.networkError")); }
    setLoading(false);
  };

  return (
    <div className="min-h-dvh bg-sand-100 flex items-center justify-center px-4">
      <motion.div
        className="w-full max-w-sm bg-white rounded-3xl shadow-xl p-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-status-wait-600 flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl text-white font-semibold">$</span>
          </div>
          <h1 className="text-xl font-semibold text-text-primary">{t("cashier.cashierLogin")}</h1>
          <p className="text-sm text-text-secondary mt-1">{t("cashier.loginDesc")}</p>
        </div>

        <div className="flex justify-center gap-3 mb-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`w-12 h-14 rounded-xl border-2 flex items-center justify-center text-xl font-semibold transition-all ${
              pin.length > i ? "border-status-wait-600 bg-status-wait-50 text-status-wait-900" : "border-sand-200 bg-white text-transparent"
            }`}>
              {pin.length > i ? "●" : "○"}
            </div>
          ))}
        </div>

        {error && (
          <motion.p className="text-center text-status-bad-600 text-sm font-semibold mb-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
            {error}
          </motion.p>
        )}

        <div className="grid grid-cols-3 gap-2 mb-6">
          {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((key) => (
            <button
              key={key || "empty"}
              onClick={() => {
                if (key === "⌫") setPin((p) => p.slice(0, -1));
                else if (key && pin.length < 6) { setPin((p) => p + key); setError(""); }
              }}
              disabled={!key}
              className={`h-14 rounded-xl text-xl font-bold transition-all active:scale-95 ${
                key === "⌫" ? "bg-sand-100 text-text-secondary" : key ? "bg-sand-50 text-text-primary hover:bg-sand-100" : "invisible"
              }`}
            >{key}</button>
          ))}
        </div>

        <button onClick={handleSubmit} disabled={pin.length < 4 || loading}
          className={`w-full py-4 rounded-2xl text-lg font-bold transition-all ${
            pin.length >= 4 && !loading ? "bg-status-wait-600 text-white hover:bg-status-wait-700" : "bg-sand-200 text-text-muted cursor-not-allowed"
          }`}
        >{loading ? t("login.verifying") : t("cashier.openRegister")}</button>

        <a href="/waiter" className="block text-center text-sm text-text-muted mt-4 hover:text-text-secondary">
          {t("login.staffLogin")}
        </a>
      </motion.div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// CASHIER ACCEPT PAYMENT (for walk-up guests)
// ═══════════════════════════════════════════════

type PaymentMethodChoice = "CASH" | "CARD" | "INSTAPAY";

function AcceptPaymentPanel({ sessions, onAcceptPayment, onReversePayment, recentlyPaidSessions, busyRef, staffId }: {
  sessions: SessionInfo[];
  onAcceptPayment: (sessionId: string, method: PaymentMethodChoice, tip: number) => Promise<{ confirmedTotal: number } | null>;
  onReversePayment: (sessionId: string, reason: string) => Promise<boolean>;
  recentlyPaidSessions: { id: string; tableNumber: number | null; orderType?: string; vipGuestName?: string | null; total: number }[];
  busyRef: React.MutableRefObject<boolean>;
  staffId?: string;
}) {
  const { t } = useLanguage();
  // Tables still needing the cashier to take payment. Gated on
  // unpaidTotal so a session that had round 1 settled and is now
  // showing a brand new round 2 order reappears with only the new
  // delta — not the gross session total.
  const openSessions = sessions.filter(
    (s) => s.status === "OPEN" && (s.unpaidTotal || 0) > 0
  );
  // Tables where payment is fully covered but kitchen is still preparing —
  // keep them visible so the cashier knows what's still in flight.
  const awaitingKitchen = sessions.filter(
    (s) => s.status === "OPEN" && (s.unpaidTotal || 0) === 0 && (s.orderTotal || 0) > 0 && s.paymentReceived
  );
  const [printing, setPrinting] = useState<string | null>(null);
  const [justPaid, setJustPaid] = useState<{ tableNumber: number | null; orderType?: string; vipGuestName?: string | null; method: PaymentMethodChoice; total: number } | null>(null);
  // Final "did you actually receive the payment?" guard before we settle.
  // Prevents accidental taps and makes the walk-up case (guest didn't tap
  // pay on their phone) an explicit, intentional action.
  const [pendingConfirm, setPendingConfirm] = useState<{
    sessionId: string;
    tableNumber: number | null;
    orderType?: string;
    vipGuestName?: string | null;
    method: PaymentMethodChoice;
    total: number;
    roundLabel: string;
    priorSummary: string | null;
  } | null>(null);
  // Lock while a settle is in flight so a double-tap on 'Yes, received'
  // can't fire the PATCH twice. The second call would be idempotent on
  // the DB side but would clobber the success flash with a 0 EGP total.
  const [settling, setSettling] = useState(false);
  // Optional tip amount the cashier enters inline with the confirm.
  // Reset every time the modal opens so a tip from the previous
  // transaction never bleeds into the next one.
  const [tipInput, setTipInput] = useState<string>("");
  // Reverse-payment confirmation state. Cashier has to type a reason,
  // so accidental taps can't roll back a correctly settled bill.
  const [reversing, setReversing] = useState<{
    sessionId: string;
    tableNumber: number | null;
    orderType?: string;
    vipGuestName?: string | null;
    total: number;
  } | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const [reverseBusy, setReverseBusy] = useState(false);
  // Print failure banner. Persistent until the cashier dismisses it —
  // a fading toast wasn't enough to catch the "30 receipts failed,
  // discovered next morning" scenario. Also surfaces paper-low
  // warnings (printer can still print but the roll is almost out).
  const [printAlert, setPrintAlert] = useState<{
    kind: "fail" | "low";
    reason?: PrintAgentOutcome["reason"];
    sessionId?: string;
  } | null>(null);

  // Run a print attempt and surface the outcome. Tries the local
  // thermal agent first; falls back to the browser's print window;
  // only declares success when one of those actually worked.
  const runPrint = async (sessionId: string) => {
    const agent = await tryAgentPrint(sessionId);
    if (agent.ok) {
      if (agent.paperLow) setPrintAlert({ kind: "low" });
      return;
    }
    // Agent path failed — try the browser fallback.
    const inv = await fetchInvoice(sessionId, staffId);
    if (inv && printInvoice(inv)) {
      // Popup opened — receipt may still print, but we still warn
      // because the agent path is the supported one.
      setPrintAlert({ kind: "fail", reason: agent.reason, sessionId });
      return;
    }
    // Neither path worked.
    setPrintAlert({ kind: "fail", reason: agent.reason || "unknown", sessionId });
  };

  // Tell the reliability hook we're mid-transaction — no reloads allowed
  // while a confirm modal is open or a settle is in flight. A reload
  // here would wipe the optimistic state and force the cashier to
  // recollect a payment they already took.
  useEffect(() => {
    busyRef.current = !!pendingConfirm || settling;
  }, [pendingConfirm, settling, busyRef]);

  const handlePrint = async (sessionId: string) => {
    setPrinting(sessionId);
    // Prefer the thermal print agent on the cashier PC — silent, no
    // print dialog. Falls back to the browser print window if the
    // agent isn't reachable. runPrint surfaces failures and paper-low
    // warnings via the printAlert banner.
    await runPrint(sessionId);
    setPrinting(null);
  };

  // Step 1: method picked — stage the confirm modal instead of settling
  // straight away. Nothing hits the server until the cashier answers Yes.
  const handleMethodChosen = (sessionId: string, method: PaymentMethodChoice) => {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    const priorRounds = session.paidRounds || [];
    const nextRoundIndex = priorRounds.length + 1;
    const roundLabel = priorRounds.length > 0
      ? `Payment ${nextRoundIndex} of ${nextRoundIndex}`
      : t("cashier.fullPayment");
    // Pre-fill the cashier's tip input with whatever the guest picked
    // on /track. The cashier can still edit; the value at confirm is
    // what gets stamped (SET, not incremented), so there's no double-
    // counting risk.
    setTipInput(session.pendingTip && session.pendingTip > 0 ? String(session.pendingTip) : "");
    // Round-scoped: when the guest signalled a partial pay, only collect
    // the slice they earmarked. Cashier sees the matching amount on the
    // confirm modal instead of the full session bill.
    const collectAmount = (session.pendingTotal ?? 0) > 0
      ? (session.pendingTotal || 0)
      : (session.unpaidTotal || 0);
    setPendingConfirm({
      sessionId,
      tableNumber: session.tableNumber,
      orderType: session.orderType,
      vipGuestName: session.vipGuestName,
      method,
      total: collectAmount,
      roundLabel,
      priorSummary: summarizePriorRounds(priorRounds),
    });
  };

  // Step 2: cashier confirms in the modal — now settle + print.
  const handleConfirmReceived = async () => {
    if (!pendingConfirm || settling) return;
    const { sessionId, tableNumber, method } = pendingConfirm;
    // Parse once at confirm time. Anything that isn't a finite positive
    // number becomes 0 — the server will also defensively discard it.
    const parsedTip = Math.max(0, Math.round(Number(tipInput) || 0));
    setSettling(true);
    setPendingConfirm(null);
    const result = await onAcceptPayment(sessionId, method, parsedTip);
    setSettling(false);
    if (result) {
      // Show the authoritative total returned from the server rather than
      // the optimistic snapshot — if a guest added an order after the pay
      // request went out, this is the number the cashier should reconcile
      // against what they physically collected.
      setJustPaid({ tableNumber, orderType: pendingConfirm.orderType, vipGuestName: pendingConfirm.vipGuestName, method, total: result.confirmedTotal });
      setTimeout(() => setJustPaid(null), 4000);
    }
    setTimeout(() => { runPrint(sessionId); }, 1500);
  };

  return (
    <div className="space-y-3">
      {/* Print failure banner — sticks until dismissed so the cashier
          knows that a receipt didn't print, instead of finding out at
          end-of-shift reconciliation. Paper-low is the gentle warning;
          fail is the loud one. */}
      {printAlert && (
        <div className={`rounded-2xl border-2 p-4 flex items-start gap-3 ${
          printAlert.kind === "fail"
            ? "bg-status-bad-50 border-status-bad-300"
            : "bg-status-warn-50 border-status-warn-300"
        }`}>
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg shrink-0 ${
            printAlert.kind === "fail" ? "bg-status-bad-500 text-white" : "bg-status-warn-500 text-white"
          }`}>
            {printAlert.kind === "fail" ? "🖨" : "⚠"}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-bold ${
              printAlert.kind === "fail" ? "text-status-bad-900" : "text-status-warn-900"
            }`}>
              {printAlert.kind === "fail"
                ? t("cashier.printFailedTitle")
                : t("cashier.paperLowTitle")}
            </p>
            <p className={`text-[11px] font-semibold ${
              printAlert.kind === "fail" ? "text-status-bad-700" : "text-status-warn-700"
            }`}>
              {printAlert.kind === "low"
                ? t("cashier.paperLowDesc")
                : printAlert.reason === "paper_out"
                  ? t("cashier.printFailPaperOut")
                  : printAlert.reason === "printer_unreachable"
                    ? t("cashier.printFailPrinterUnreachable")
                    : printAlert.reason === "agent_unreachable"
                      ? t("cashier.printFailAgentUnreachable")
                      : t("cashier.printFailGeneric")}
            </p>
          </div>
          <div className="flex flex-col gap-1.5 shrink-0">
            {printAlert.kind === "fail" && printAlert.sessionId && (
              <button
                onClick={() => { if (printAlert.sessionId) runPrint(printAlert.sessionId); }}
                className="px-3 py-1.5 rounded-lg bg-status-bad-600 text-white text-[11px] font-bold active:scale-95"
              >
                {t("cashier.retryPrint")}
              </button>
            )}
            <button
              onClick={() => setPrintAlert(null)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-bold active:scale-95 ${
                printAlert.kind === "fail"
                  ? "bg-white text-status-bad-700 border border-status-bad-300"
                  : "bg-white text-status-warn-700 border border-status-warn-300"
              }`}
            >
              {t("cashier.dismiss")}
            </button>
          </div>
        </div>
      )}

      {/* Final confirmation modal — guards against accidental settles AND
          makes the walk-up case (guest never tapped pay) an explicit action. */}
      {pendingConfirm && (
        <div className="fixed inset-0 z-50 bg-sand-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${
                pendingConfirm.method === "CASH" ? "bg-status-good-50" : pendingConfirm.method === "CARD" ? "bg-status-info-50" : "bg-status-wait-50"
              }`}>
                {pendingConfirm.method === "CASH" ? "💵" : pendingConfirm.method === "CARD" ? "💳" : "📱"}
              </div>
              <div>
                <h3 className="text-base font-semibold text-text-primary">
                  {t("cashier.received")} {pendingConfirm.roundLabel.toLowerCase()}?
                </h3>
                <p className="text-xs text-text-secondary font-semibold">
                  {getOrderLabel(pendingConfirm)} · {formatEGP(pendingConfirm.total)} {t("common.egp")} ·{" "}
                  {pendingConfirm.method === "CASH" ? t("cashier.cash") : pendingConfirm.method === "CARD" ? t("cashier.card") : t("cashier.instapay")}
                </p>
              </div>
            </div>
            {pendingConfirm.priorSummary && (
              <div className="mb-4 rounded-xl bg-sand-50 border border-sand-200 px-3 py-2">
                <p className="text-[10px] font-bold text-text-muted uppercase tracking-wider">{t("cashier.alreadyPaid")}</p>
                <p className="text-xs font-bold text-text-secondary tabular-nums">{pendingConfirm.priorSummary}</p>
              </div>
            )}
            {/* Optional tip input. Blank by default; cashier types an
                amount only if the guest left a tip for this round. Saved
                on the first settled order so sum(Order.tip) is the truth. */}
            <div className="mb-4">
              <label className="text-[10px] font-bold text-text-muted uppercase tracking-wider mb-1 block">
                {t("cashier.tipOptional")}
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={tipInput}
                  onChange={(e) => setTipInput(e.target.value)}
                  placeholder="0"
                  className="flex-1 rounded-xl border border-sand-200 bg-white px-3 py-2 text-sm font-bold text-text-primary tabular-nums focus:outline-none focus:ring-2 focus:ring-status-good-500"
                />
                <span className="text-xs font-bold text-text-secondary">{t("common.egp")}</span>
              </div>
            </div>
            <p className="text-sm text-text-secondary mb-5">
              {t("cashier.confirmOnlyAfter")}{" "}
              <b>{pendingConfirm.roundLabel}</b> {t("cashier.andPrintsReceipt")}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPendingConfirm(null)}
                disabled={settling}
                className="flex-1 py-3 rounded-xl bg-sand-100 text-text-secondary text-sm font-bold active:scale-95 disabled:opacity-50"
              >
                {t("cashier.noCancel")}
              </button>
              <button
                onClick={handleConfirmReceived}
                disabled={settling}
                className={`flex-1 py-3 rounded-xl text-white text-sm font-bold active:scale-95 disabled:opacity-60 ${
                  pendingConfirm.method === "CASH" ? "bg-status-good-600" : pendingConfirm.method === "CARD" ? "bg-status-info-600" : "bg-status-wait-600"
                }`}
              >
                {settling ? t("cashier.confirming") : t("cashier.yesReceived")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Instant confirmation flash */}
      {justPaid && (
        <div className="animate-in fade-in slide-in-from-top-2 duration-200 bg-status-good-600 text-white rounded-2xl px-4 py-3 flex items-center gap-3 shadow-lg shadow-status-good-600/30">
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center text-lg">
            ✓
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">
              {t("cashier.confirmed")} · {formatEGP(justPaid.total)} {t("common.egp")} — {getOrderLabel(justPaid)}
            </p>
            <p className="text-[11px] text-status-good-100 font-semibold">
              {justPaid.method === "CASH" ? t("cashier.cashReceivedMsg") : justPaid.method === "CARD" ? t("cashier.cardCharged") : t("cashier.instapayCharged")} · {t("cashier.printingReceipt")}
            </p>
          </div>
        </div>
      )}

      {/* Recently paid — print receipts */}
      {recentlyPaidSessions.length > 0 && (
        <div className="bg-status-good-50 rounded-2xl border-2 border-status-good-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-status-good-200">
            <h3 className="text-sm font-semibold text-status-good-800 uppercase tracking-wide">{t("cashier.printReceipts")}</h3>
            <p className="text-[10px] text-status-good-600">{recentlyPaidSessions.length} {t("cashier.recentlyClosed")}</p>
          </div>
          <div className="divide-y divide-status-good-100">
            {recentlyPaidSessions.map((s) => (
              <div key={s.id} className="px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-status-good-100 border border-status-good-300 flex items-center justify-center text-sm font-semibold text-status-good-700">
                    {s.tableNumber ?? "V"}
                  </div>
                  <div>
                    <span className="text-sm font-bold text-status-good-900">{getOrderLabel(s)}</span>
                    <span className="text-xs text-status-good-600 ml-2">{formatEGP(s.total)} {t("common.egp")}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => handlePrint(s.id)} disabled={printing === s.id}
                    className="px-4 py-2 rounded-xl bg-status-good-600 text-white text-sm font-bold active:scale-95 disabled:opacity-50">
                    {printing === s.id ? "..." : `🖨 ${t("cashier.print")}`}
                  </button>
                  <button
                    onClick={() => { setReversing({ sessionId: s.id, tableNumber: s.tableNumber, orderType: s.orderType, vipGuestName: s.vipGuestName, total: s.total }); setReverseReason(""); }}
                    title={t("cashier.reversePaymentTitle")}
                    className="px-2.5 py-2 rounded-xl bg-white text-status-bad-600 border border-status-bad-200 text-xs font-bold active:scale-95 hover:bg-status-bad-50"
                  >
                    {t("cashier.reverse")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reverse payment confirmation modal */}
      {reversing && (
        <div className="fixed inset-0 z-50 bg-sand-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl bg-status-bad-50 flex items-center justify-center text-2xl">↩</div>
              <div>
                <h3 className="text-base font-semibold text-text-primary">{t("cashier.reversePayment")}</h3>
                <p className="text-xs text-text-secondary font-semibold">
                  {getOrderLabel(reversing)} · {formatEGP(reversing.total)} {t("common.egp")}
                </p>
              </div>
            </div>
            <p className="text-sm text-text-secondary mb-3">
              {t("cashier.reverseDesc")} <b>{t("cashier.acceptPayment")}</b> {t("cashier.reverseDescEnd")}
            </p>
            <label className="block text-[10px] font-semibold text-text-secondary uppercase tracking-wider mb-1">
              {t("cashier.reasonRequired")}
            </label>
            <input
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
              placeholder={t("cashier.reasonPlaceholder")}
              className="w-full px-3 py-2.5 rounded-xl border-2 border-sand-200 text-sm mb-4 focus:border-status-bad-400 focus:outline-none"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setReversing(null); setReverseReason(""); }}
                disabled={reverseBusy}
                className="flex-1 py-3 rounded-xl bg-sand-100 text-text-secondary text-sm font-bold active:scale-95 disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>
              <button
                onClick={async () => {
                  if (!reversing || reverseReason.trim().length < 3) return;
                  setReverseBusy(true);
                  const ok = await onReversePayment(reversing.sessionId, reverseReason.trim());
                  setReverseBusy(false);
                  if (ok) { setReversing(null); setReverseReason(""); }
                }}
                disabled={reverseBusy || reverseReason.trim().length < 3}
                className="flex-1 py-3 rounded-xl bg-status-bad-600 text-white text-sm font-bold active:scale-95 disabled:opacity-60"
              >
                {reverseBusy ? t("cashier.reversing") : t("cashier.yesReverse")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Paid, waiting on kitchen */}
      {awaitingKitchen.length > 0 && (
        <div className="bg-status-warn-50 rounded-2xl border-2 border-status-warn-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-status-warn-200">
            <h3 className="text-sm font-semibold text-status-warn-800 uppercase tracking-wide">{t("cashier.paidKitchenInProgress")}</h3>
            <p className="text-[10px] text-status-warn-600">{awaitingKitchen.length} {awaitingKitchen.length !== 1 ? t("cashier.tablesPlural") : t("cashier.tables")} — {t("cashier.sessionClosesAuto")}</p>
          </div>
          <div className="divide-y divide-status-warn-100">
            {awaitingKitchen.map((s) => (
              <div key={s.id} className="px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-status-warn-100 border border-status-warn-300 flex items-center justify-center text-sm font-semibold text-status-warn-700">
                    {s.tableNumber ?? "V"}
                  </div>
                  <div>
                    <span className="text-sm font-bold text-status-warn-900">{getOrderLabel(s)}</span>
                    <span className="text-xs text-status-warn-600 ml-2">{formatEGP(s.orderTotal || 0)} {t("common.egp")} · {t("cashier.paid")}</span>
                  </div>
                </div>
                <button onClick={() => handlePrint(s.id)} disabled={printing === s.id}
                  className="px-3 py-2 rounded-xl bg-status-warn-600 text-white text-sm font-bold active:scale-95 disabled:opacity-50">
                  {printing === s.id ? "..." : "🖨"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Open bills — money-side hero. Total amount is the largest thing on the card. */}
      <div>
        <div className="flex items-baseline justify-between mb-3 px-1">
          <h3 className="text-xl font-extrabold text-text-primary leading-none">{t("cashier.acceptPayment")}</h3>
          <span className="text-[11px] font-extrabold uppercase tracking-widest text-text-muted">
            {openSessions.length} {t("cashier.openBills")}
          </span>
        </div>
        {openSessions.length === 0 ? (
          <div className="bg-white rounded-2xl border-2 border-sand-200 p-10 text-center">
            <div className="text-5xl mb-3 opacity-40">💸</div>
            <p className="text-sm text-text-muted">{t("cashier.noPendingBillsShort")}</p>
          </div>
        ) : (
          <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
            {openSessions.map((s) => {
              const priorRounds = s.paidRounds || [];
              const priorSummary = summarizePriorRounds(priorRounds);
              const nextRoundIndex = priorRounds.length + 1;
              const hasPriorPayment = priorRounds.length > 0;
              // Round-scoped figures. When the guest has signalled a
              // split-pay (some items have paymentMethod stamped, some
              // don't), pendingTotal is the slice the cashier is about
              // to collect on. Otherwise we fall back to the full
              // unpaid bill.
              const hasPendingRound = (s.pendingTotal ?? 0) > 0;
              const roundAmount = hasPendingRound ? (s.pendingTotal || 0) : (s.unpaidTotal || 0);
              const visibleItems = hasPendingRound
                ? (s.unpaidItems || []).filter((it) => it.pending)
                : (s.unpaidItems || []);
              const remainingAfterRound = (s.unpaidTotal || 0) - roundAmount;
              return (
              <div key={s.id} className="bg-white rounded-2xl border-2 border-sand-200 overflow-hidden">
                {/* Identity row */}
                <div className="px-5 pt-5 pb-3 flex items-start gap-4">
                  <div className={`flex-shrink-0 w-16 h-16 rounded-2xl border-2 flex items-center justify-center text-2xl font-extrabold ${
                    s.orderType === "DELIVERY" ? "bg-status-warn-50 border-status-warn-200 text-status-warn-700" :
                    s.orderType === "VIP_DINE_IN" ? "bg-status-wait-50 border-status-wait-200 text-status-wait-700" :
                    "bg-status-wait-50 border-status-wait-200 text-status-wait-700"
                  }`}>
                    {s.orderType === "DELIVERY" ? "\u{1F6F5}" : s.orderType === "VIP_DINE_IN" ? "\u{1F451}" : s.tableNumber}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xl font-extrabold text-text-primary leading-tight truncate">
                      {getOrderLabel(s)}
                    </div>
                    <div className="text-xs text-text-muted mt-1 truncate">
                      {s.orderType !== "DELIVERY" && (
                        <>{s.guestCount} {s.guestCount !== 1 ? t("common.guests") : t("common.guest")}</>
                      )}
                      {s.waiterName && (
                        <>{s.orderType !== "DELIVERY" ? " · " : ""}{s.waiterName}</>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handlePrint(s.id)}
                    disabled={printing === s.id}
                    className="flex-shrink-0 w-11 h-11 rounded-xl bg-sand-100 hover:bg-sand-200 text-text-secondary flex items-center justify-center text-base transition disabled:opacity-50 active:scale-95"
                    title={t("cashier.printBillPreview")}
                  >
                    {printing === s.id ? "…" : "🖨"}
                  </button>
                </div>

                {/* HERO — total due. The single largest element on the card. */}
                <div className="px-5 pb-3 text-center">
                  <div className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-text-muted mb-1.5">
                    {hasPendingRound
                      ? (s.pendingPaymentMethod ? t("cashier.collect") : t("cashier.totalDue"))
                      : hasPriorPayment ? `${t("cashier.payment")} ${nextRoundIndex}` : t("cashier.totalDue")}
                  </div>
                  <div className="text-5xl font-extrabold text-text-primary tabular-nums leading-none tracking-tight">
                    {formatEGP(roundAmount)}
                    <span className="text-xl text-text-muted font-bold ms-2">{t("common.egp")}</span>
                  </div>
                  {hasPendingRound && remainingAfterRound > 0 && (
                    <div className="text-[11px] font-bold text-text-muted mt-1.5">
                      {t("cashier.partialPayBadge")} · {formatEGP(remainingAfterRound)} {t("common.egp")} {t("cashier.partialPayRemaining")}
                    </div>
                  )}
                </div>

                {/* Itemised breakdown — what's actually being collected on.
                    Cashier was previously seeing the total alone, which made
                    it impossible to verify a disputed bill ("you charged me
                    for 3 coffees, I had 2") without printing first. When
                    the guest signalled a split-pay, this list narrows to
                    just the items in the pending round. */}
                {visibleItems.length > 0 && (
                  <div className="mx-5 mb-3 rounded-lg bg-sand-50 border border-sand-200 divide-y divide-sand-200/70">
                    {visibleItems.map((it, idx) => {
                      const addOnLabels = (it.addOns || [])
                        .map((a) => { try { const p = JSON.parse(a); return p.name || a; } catch { return a; } })
                        .filter(Boolean);
                      const lineTotal = Math.round(it.price * it.quantity);
                      return (
                        <div key={idx} className="px-3 py-2 flex items-start gap-3">
                          <span className="text-sm font-extrabold text-text-primary tabular-nums shrink-0 w-6 text-end">
                            {it.quantity}×
                          </span>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-bold text-text-primary leading-tight truncate">
                              {it.name}
                            </div>
                            {(addOnLabels.length > 0 || it.notes) && (
                              <div className="text-[11px] text-text-muted leading-snug mt-0.5">
                                {addOnLabels.length > 0 && (
                                  <span>+ {addOnLabels.join(", ")}</span>
                                )}
                                {addOnLabels.length > 0 && it.notes && <span> · </span>}
                                {it.notes && <span className="italic">&ldquo;{it.notes}&rdquo;</span>}
                              </div>
                            )}
                          </div>
                          <span className="text-sm font-extrabold text-text-primary tabular-nums shrink-0">
                            {formatEGP(lineTotal)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Prior rounds context (when this is a follow-up payment) */}
                {hasPriorPayment && priorSummary && (
                  <div className="mx-5 mb-4 rounded-lg bg-status-good-50 border border-status-good-200 px-3 py-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-extrabold text-status-good-700 uppercase tracking-widest">
                      {t("cashier.alreadyPaid")} · {priorRounds.length} {priorRounds.length !== 1 ? t("cashier.roundsPlural") : t("cashier.rounds")}
                    </span>
                    <span className="text-sm font-extrabold text-status-good-800 tabular-nums">{priorSummary}</span>
                  </div>
                )}

                {/* Direct payment-method buttons. No intermediate "Process Payment" step —
                    safety is in the confirm modal that fires next.
                    When the guest already picked a method on /track, that
                    method is highlighted and the others dimmed so the
                    cashier can't second-guess (or accidentally settle)
                    the wrong one. */}
                {s.pendingPaymentMethod && (
                  <div className="mx-5 mb-3 rounded-lg bg-ocean-50 border border-ocean-200 px-3 py-2 flex items-center justify-between gap-2">
                    <span className="text-[10px] font-extrabold text-ocean-700 uppercase tracking-widest">
                      {t("cashier.guestChose")}
                    </span>
                    <span className="text-sm font-extrabold text-ocean-800">
                      {s.pendingPaymentMethod === "CASH" ? `💵 ${t("cashier.cash")}` :
                       s.pendingPaymentMethod === "CARD" ? `💳 ${t("cashier.card")}` :
                       `📱 ${t("cashier.instapay")}`}
                      {(s.pendingTip || 0) > 0 && (
                        <span className="ms-2 text-xs font-bold text-ocean-700">
                          + {formatEGP(s.pendingTip || 0)} {t("common.egp")} tip
                        </span>
                      )}
                    </span>
                  </div>
                )}
                <div className="grid grid-cols-3 border-t-2 border-sand-200">
                  {([
                    ["CASH", "💵", t("cashier.cash"), "bg-status-good-500 hover:bg-status-good-600"],
                    ["CARD", "💳", t("cashier.card"), "bg-status-info-500 hover:bg-status-info-600"],
                    ["INSTAPAY", "📱", t("cashier.instapay"), "bg-status-wait-500 hover:bg-status-wait-600"],
                  ] as [PaymentMethodChoice, string, string, string][]).map(([key, icon, label, color], idx) => {
                    const isPreferred = !s.pendingPaymentMethod || s.pendingPaymentMethod === key;
                    return (
                      <button
                        key={key}
                        onClick={() => handleMethodChosen(s.id, key)}
                        className={`py-5 text-sm font-extrabold uppercase tracking-wider text-white transition active:scale-[0.99] flex items-center justify-center gap-1.5 ${color} ${idx > 0 ? "border-l-2 border-sand-200" : ""} ${isPreferred ? "" : "opacity-30 saturate-50"}`}
                      >
                        <span className="text-xl leading-none">{icon}</span>
                        <span className="truncate">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════
// SHIFT SUMMARY
//
// Single card replacing the old three-card stack (CashierWallet +
// RevenueSummary + ShiftComparison). The cashier sees one money
// snapshot for their shift instead of mentally diffing three boxes
// that all carried overlapping numbers.
//
// Layout:
//   • Header: "This Shift"
//   • Hero: shift revenue (with order count)
//   • Breakdown: cash, card/digital, optional unpaid (only when > 0)
//   • Dim footer: today's total — there for end-of-shift handover,
//     not for in-shift work
//
// Note: there used to be a "balanced / leakage / over-collected"
// status pill here. It came from comparing shiftRevenue against
// (cash + card + unpaid), but the cashout endpoint that populates
// shiftRevenue includes only PAID orders, so cash + card already
// equals shiftRevenue by construction — meaning gap was always
// −unpaid, falsely flagging "over-collected" whenever any table
// was open. Real cash leakage is caught by the DrawerPanel
// reconciliation above (physical count vs expected). Removed.
// ═══════════════════════════════════════════════

function ShiftSummary({
  shiftRevenue,
  shiftOrders,
  cashCollected,
  cardCollected,
  dayRevenue,
  activeSessions,
}: {
  shiftRevenue: number;
  shiftOrders: number;
  cashCollected: number;
  cardCollected: number;
  dayRevenue: number;
  activeSessions: SessionInfo[];
}) {
  const { t } = useLanguage();

  const unpaid = activeSessions.filter(
    (s) => s.status === "OPEN" && (s.unpaidTotal || 0) > 0,
  );
  const unpaidTotal = unpaid.reduce((sum, s) => sum + (s.unpaidTotal || 0), 0);
  const unpaidCount = unpaid.length;

  return (
    <div className="bg-white rounded-2xl border-2 border-sand-200 overflow-hidden shadow-sm">
      {/* Header */}
      <div className="px-5 py-3 bg-sand-50 border-b-2 border-sand-200">
        <h3 className="text-[11px] font-extrabold text-text-primary uppercase tracking-[0.2em]">
          {t("shiftSummary.title")}
        </h3>
      </div>

      {/* Hero — shift revenue */}
      <div className="px-5 pt-5 pb-4 text-center border-b border-sand-100">
        <p className="text-[10px] text-text-muted font-extrabold uppercase tracking-[0.2em] mb-2">
          {t("shiftSummary.shiftRevenue")}
        </p>
        <p className="text-4xl font-extrabold text-text-primary tabular-nums tracking-tight leading-none">
          {formatEGP(shiftRevenue)}
          <span className="text-base text-text-muted font-bold ms-1.5">
            {t("common.egp")}
          </span>
        </p>
        <p className="text-[11px] text-text-muted font-medium mt-2">
          {shiftOrders} {t("cashier.orders")}
        </p>
      </div>

      {/* Breakdown — collected + (optional) unpaid */}
      <div className="px-5 py-4 space-y-2.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-text-secondary font-semibold">
            {t("shiftSummary.cashCollected")}
          </span>
          <span className="text-base font-extrabold text-status-good-700 tabular-nums">
            {formatEGP(cashCollected)}{" "}
            <span className="text-[10px] font-bold text-text-muted">
              {t("common.egp")}
            </span>
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-text-secondary font-semibold">
            {t("shiftSummary.cardCollected")}
          </span>
          <span className="text-base font-extrabold text-status-info-700 tabular-nums">
            {formatEGP(cardCollected)}{" "}
            <span className="text-[10px] font-bold text-text-muted">
              {t("common.egp")}
            </span>
          </span>
        </div>
        {unpaidCount > 0 && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-status-warn-700 font-semibold">
              {t("shiftSummary.unpaidTables")} · {unpaidCount}{" "}
              {unpaidCount === 1
                ? t("shiftSummary.unpaidTable")
                : t("shiftSummary.unpaidTablesPlural")}
            </span>
            <span className="text-base font-extrabold text-status-warn-700 tabular-nums">
              {formatEGP(unpaidTotal)}{" "}
              <span className="text-[10px] font-bold text-text-muted">
                {t("common.egp")}
              </span>
            </span>
          </div>
        )}
      </div>

      {/* Dim footer — today's running total. Helpful at handover, not
          load-bearing during a shift, so it doesn't compete with the
          hero. */}
      <div className="px-5 py-2.5 bg-sand-50 border-t border-sand-100 flex items-center justify-between gap-3">
        <span className="text-[10px] text-text-muted font-bold uppercase tracking-widest">
          {t("shiftSummary.todaySoFar")}
        </span>
        <span className="text-xs font-extrabold text-text-secondary tabular-nums">
          {formatEGP(dayRevenue)}{" "}
          <span className="text-[9px] font-bold text-text-muted">
            {t("common.egp")}
          </span>
        </span>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════
// MAIN: CASHIER SYSTEM
// ═══════════════════════════════════════════════

export default function CashierPage() {
  const [loggedInStaff, setLoggedInStaff] = useState<LoggedInStaff | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Restore session after hydration to avoid SSR mismatch
  // Session persists for 16 hours to survive mid-shift phone sleep/lock
  useEffect(() => {
    try {
      const saved = localStorage.getItem("cashier_staff");
      if (saved) {
        const parsed = JSON.parse(saved);
        const loginAt = parsed.loginAt || 0;
        if (Date.now() - loginAt < 16 * 60 * 60 * 1000) {
          setLoggedInStaff(parsed);
        } else {
          localStorage.removeItem("cashier_staff");
        }
      }
    } catch { /* silent */ }
    setHydrated(true);
  }, []);

  const handleLogin = useCallback((staff: LoggedInStaff) => {
    const staffWithLogin = { ...staff, loginAt: Date.now() };
    localStorage.setItem("cashier_staff", JSON.stringify(staffWithLogin));
    setLoggedInStaff(staffWithLogin);
  }, []);

  const handleLogout = useCallback(() => {
    localStorage.removeItem("cashier_staff");
    setLoggedInStaff(null);
  }, []);

  // Show nothing until hydrated to prevent flash of login screen
  if (!hydrated) {
    return (
      <div className="min-h-dvh bg-sand-100 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-sand-300 border-t-status-wait-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (!loggedInStaff) return <CashierLogin onLogin={handleLogin} />;
  return <CashierSystem staff={loggedInStaff} onLogout={handleLogout} />;
}

function CashierSystem({ staff, onLogout }: { staff: LoggedInStaff; onLogout: () => void }) {
  const { lang, toggleLang, t, dir } = useLanguage();

  const restaurantSlug = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [recentlyPaid, setRecentlyPaid] = useState<{ id: string; tableNumber: number | null; orderType?: string; vipGuestName?: string | null; total: number }[]>([]);
  const [dayRevenue, setDayRevenue] = useState(0);
  const [shiftRevenue, setShiftRevenue] = useState(0);
  const [shiftOrders, setShiftOrders] = useState(0);
  const [cashCollected, setCashCollected] = useState(0);
  const [cardCollected, setCardCollected] = useState(0);
  const [dayTips, setDayTips] = useState(0);
  const [shiftTips, setShiftTips] = useState(0);
  const [shiftTipsByWaiter, setShiftTipsByWaiter] = useState<{ id: string; name: string; tips: number }[]>([]);
  const [shiftInfo, setShiftInfo] = useState(() => getShiftTimer(staff.shift, "CASHIER"));
  const [showSchedule, setShowSchedule] = useState(false);

  // Shared gate: true while the cashier is confirming or settling a
  // payment. Every auto-reload (watchdog, 5am, version) respects it.
  const busyRef = useRef(false);
  const { newVersion, markApiOk, reloadNow } = useCashierReliability(busyRef);
  const [connectionLost, setConnectionLost] = useState(false);
  const failCountRef = useRef(0);

  // Shift label ticker — runs at 30s instead of 1s because the label is
  // minute-resolution ("2h 14m remaining") and every second tick was
  // re-rendering the entire cashier tree (CashierWallet + RevenueSummary
  // + ShiftComparison + AcceptPaymentPanel) for nothing. Combined with
  // the stray useLiveData() subscription and an unused perception.orders
  // selector, post-transaction renders were piling up until the tab
  // stopped responding. We also bail out of setState when the label
  // hasn't actually changed so identical ticks are no-ops.
  useEffect(() => {
    const tick = () => {
      const next = getShiftTimer(staff.shift, "CASHIER");
      setShiftInfo((prev) =>
        prev.label === next.label && prev.isOnShift === next.isOnShift ? prev : next
      );
    };
    tick();
    const id = setInterval(tick, 60000);
    // Re-check shift immediately when tab regains focus (covers idle/sleep gaps)
    const onVisible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVisible); };
  }, [staff.shift]);

  // Notifications
  useEffect(() => { requestNotificationPermission(); }, []);

  // Push subscription. `lang` in deps so toggling the language re-
  // subscribes with the new lang, and future pushes land translated.
  useEffect(() => {
    import("@/lib/push-client").then(({ subscribeToPush }) => {
      subscribeToPush(staff.id, "CASHIER", restaurantSlug, lang as "en" | "ar").catch(() => {});
    });
  }, [staff.id, restaurantSlug, lang]);

  // Poll sessions — visibility-aware, with an AbortController so a new
  // tick can never race a still-pending previous request. This is the
  // fix for the "cashier freezes then whitescreens after idle" bug:
  // without visibility pause + abort, a backgrounded tablet would pile
  // up hundreds of pending fetches, and when the cashier returned the
  // stacked re-renders locked the main thread hard enough that the
  // tab couldn't even open devtools.
  //
  // refreshSessions is exposed via ref so the payment confirm path can
  // trigger an immediate refetch on error, without waiting for the next
  // poll tick. Used by handleAcceptPayment to trust server state instead
  // of rolling back optimistically — see the long comment there.
  const sessionsAbortRef = useRef<AbortController | null>(null);
  const refreshSessions = useCallback(async () => {
    sessionsAbortRef.current?.abort();
    const ctrl = new AbortController();
    sessionsAbortRef.current = ctrl;
    try {
      const res = await fetch(`/api/sessions/all?restaurantId=${restaurantSlug}`, {
        signal: ctrl.signal,
        headers: { "x-staff-id": staff.id },
      });
      markApiOk();
      if (res.ok) {
        failCountRef.current = 0;
        setConnectionLost(false);
        const data = await res.json();
        const allSessions: SessionInfo[] = data.sessions || [];
        setSessions(allSessions);
        const closed = allSessions.filter((s) => s.status === "CLOSED" && (s.orderTotal || 0) > 0);
        setRecentlyPaid(closed.slice(0, 5).map((s) => ({ id: s.id, tableNumber: s.tableNumber, orderType: s.orderType, vipGuestName: s.vipGuestName, total: s.orderTotal || 0 })));
      } else {
        failCountRef.current += 1;
        if (failCountRef.current >= 3) setConnectionLost(true);
      }
    } catch (err) {
      if ((err as Error)?.name === "AbortError") return;
      failCountRef.current += 1;
      if (failCountRef.current >= 3) setConnectionLost(true);
    }
  }, [restaurantSlug, staff.id, markApiOk]);

  useEffect(() => {
    refreshSessions();
    const stop = startPoll(refreshSessions, 20000);
    return () => { stop(); sessionsAbortRef.current?.abort(); };
  }, [refreshSessions]);

  // Poll cashout data for revenue — same treatment
  useEffect(() => {
    let currentAbort: AbortController | null = null;
    const fetch_ = async () => {
      currentAbort?.abort();
      const ctrl = new AbortController();
      currentAbort = ctrl;
      try {
        const res = await fetch(`/api/shifts/cashout?restaurantId=${restaurantSlug}`, { signal: ctrl.signal, headers: staff?.id ? { "x-staff-id": staff.id } : {} });
        markApiOk();
        if (res.ok) {
          const data = await res.json();
          let totalDayRevenue = 0;
          let totalShiftRevenue = 0, totalShiftOrders = 0;
          let totalCash = 0, totalCard = 0;
          let totalDayTips = 0, totalShiftTips = 0;
          // Aggregate per-waiter shift tips across the days returned —
          // typically just today, but the response structure supports
          // longer windows.
          const shiftWaiterTips = new Map<string, { id: string; name: string; tips: number }>();
          const currentShift = getCurrentShift();

          for (const day of data.days || []) {
            totalDayRevenue += day.revenue || 0;
            totalCash += day.cash || 0;
            totalCard += day.card || 0;
            totalDayTips += day.tips || 0;
            for (const shift of day.shifts || []) {
              for (const w of shift.waiters || []) {
                if (shift.shift === currentShift) {
                  totalShiftRevenue += w.totalRevenue || 0;
                  totalShiftOrders += w.totalOrders || 0;
                  totalShiftTips += w.tips || 0;
                  if ((w.tips || 0) > 0) {
                    const existing = shiftWaiterTips.get(w.id);
                    shiftWaiterTips.set(w.id, {
                      id: w.id,
                      name: w.name,
                      tips: (existing?.tips || 0) + (w.tips || 0),
                    });
                  }
                }
              }
            }
          }

          setDayRevenue(totalDayRevenue);
          setShiftRevenue(totalShiftRevenue);
          setShiftOrders(totalShiftOrders);
          setCashCollected(totalCash);
          setCardCollected(totalCard);
          setDayTips(totalDayTips);
          setShiftTips(totalShiftTips);
          setShiftTipsByWaiter(Array.from(shiftWaiterTips.values()));
        }
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
      }
    };
    fetch_();
    const stop = startPoll(fetch_, 30000);
    return () => { stop(); currentAbort?.abort(); };
  }, [restaurantSlug, markApiOk]);

  // Accept payment at cashier — optimistic so the row moves out of
  // 'Accept Payment' into 'Paid · Kitchen in Progress' immediately,
  // without waiting for the next 5s poll.
  //
  // Optimistically zero the row so the cashier sees the bill leave the
  // "Accept Payment" list immediately, without waiting for the next
  // 20s poll.
  //
  // CRITICAL: do NOT roll back optimistically on error.
  //
  // The earlier rollback path was a real money risk. Sequence:
  //   T=0   cashier taps Yes received
  //   T=0   server commits confirmPayRound (orders are PAID in DB)
  //   T=30s Vercel times out the response (502 / network drop)
  //   UI    saw !res.ok, rolled back unpaidTotal to prior
  //   T=30s cashier sees the row reappear, taps Accept again
  //   T=30s second call hits the noop branch (orders already paid),
  //         returns confirmedTotal:0
  //   UI    "0 EGP confirmed" toast — cashier panics
  //   maybe cashier taps Reverse → erases real revenue from books
  //
  // Instead: keep the optimistic state and trust the server. Trigger
  // an immediate refetch so the UI converges to truth in <1s. If the
  // server actually failed (rare DB-level error), the next poll
  // restores unpaidTotal honestly and the cashier sees the row again
  // — same outcome as the rollback path, without the timeout footgun.
  const handleAcceptPayment = useCallback(async (
    sessionId: string,
    method: PaymentMethodChoice,
    tip: number,
  ): Promise<{ confirmedTotal: number } | null> => {
    setSessions((prev) => prev.map((s) =>
      s.id === sessionId ? { ...s, paymentReceived: true, unpaidTotal: 0 } : s,
    ));
    try {
      const res = await staffFetch(staff.id, "/api/sessions/pay", {
        method: "PATCH",
        body: JSON.stringify({ sessionId, paymentMethod: method, tip }),
      });
      if (!res.ok) {
        const text = await res.text();
        console.error("Payment failed:", text);
        // Don't roll back — refetch and let server state win.
        await refreshSessions();
        return null;
      }
      const data = await res.json();
      return { confirmedTotal: typeof data.confirmedTotal === "number" ? data.confirmedTotal : 0 };
    } catch (err) {
      console.error("Payment failed:", err);
      // Same: refetch instead of rolling back. A timeout-after-commit
      // is the worst case we're protecting against here.
      await refreshSessions();
      return null;
    }
  }, [staff.id, refreshSessions]);

  // Reverse a just-settled payment. Kept separate from handleAcceptPayment
  // because the optimistic model is different — we don't zero the unpaid
  // total, we re-expose it. Server is source of truth; poll will refresh
  // state within 20s but we also nudge by flipping the recentlyPaid row
  // off the list immediately.
  const handleReversePayment = useCallback(async (
    sessionId: string,
    reason: string,
  ): Promise<boolean> => {
    try {
      const res = await staffFetch(staff.id, "/api/sessions/pay/reverse", {
        method: "POST",
        body: JSON.stringify({ sessionId, staffId: staff.id, reason }),
      });
      if (!res.ok) {
        console.error("Reverse failed:", await res.text());
        return false;
      }
      // Remove from recently-paid optimistically — next poll will
      // re-populate openSessions with the reopened bill.
      setRecentlyPaid((prev) => prev.filter((s) => s.id !== sessionId));
      return true;
    } catch (err) {
      console.error("Reverse failed:", err);
      return false;
    }
  }, [staff.id]);


  const isOnShift = staff.shift === 0 || shiftInfo.isOnShift;

  return (
    <div className="min-h-dvh bg-sand-100" dir={dir}>
      {/* ═══ OFF-SHIFT OVERLAY ═══ */}
      {!isOnShift && staff.shift !== 0 && (
        <div className="fixed inset-0 z-50 bg-sand-900/80 flex items-center justify-center px-4">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center shadow-2xl">
            <div className="w-16 h-16 rounded-2xl bg-status-bad-100 flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">🕐</span>
            </div>
            <h2 className="text-xl font-semibold text-text-primary mb-2">{t("cashier.offShift")}</h2>
            <p className="text-sm text-text-secondary mb-1">{getShiftLabel(staff.shift, staff.role)}</p>
            <p className="text-lg font-bold text-status-bad-600 mb-4">{shiftInfo.label}</p>
            <p className="text-xs text-text-muted mb-6">{t("cashier.offShiftViewOnly")}</p>
            <button onClick={onLogout} className="w-full py-3 rounded-xl bg-sand-900 text-white font-bold text-sm">
              {t("cashier.logOut")}
            </button>
          </div>
        </div>
      )}

      {/* Connection lost banner */}
      {connectionLost && (
        <div className="sticky top-0 z-50 bg-status-bad-600 text-white px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-status-bad-300 animate-pulse" />
            <span className="text-sm font-bold">{t("cashier.connectionLost")}</span>
          </div>
          <button onClick={() => window.location.reload()} className="px-3 py-1 rounded-lg bg-white/20 text-xs font-bold active:scale-95">
            {t("cashier.reload")}
          </button>
        </div>
      )}
      {/* Header — mobile-first: logo + name + clock + kebab. Logout,
          Schedule, Language collapse into a dropdown on small viewports. */}
      <header className={`bg-white sticky ${connectionLost ? "top-[42px]" : "top-0"} z-20 border-b-2 border-sand-200 px-3 sm:px-6 py-2.5`}>
        <div className="max-w-5xl mx-auto">
          <div className="flex items-center gap-2 mb-2">
            {/* Logo — compact on mobile */}
            <div className="w-8 h-8 rounded-lg bg-status-wait-600 flex items-center justify-center flex-shrink-0">
              <span className="text-sm text-white font-semibold">$</span>
            </div>
            {/* Name + badge + status. Revenue line hides below sm to save room. */}
            <div className="min-w-0 flex-1">
              <h1 className="text-sm sm:text-lg font-semibold text-text-primary flex items-center gap-1.5 truncate">
                <span className="truncate">{staff.name}</span>
                <span className="text-[9px] sm:text-xs font-semibold px-1.5 sm:px-2 py-0.5 rounded-lg bg-status-wait-100 text-status-wait-600 flex-shrink-0">{t("cashier.cashierBadge")}</span>
                <span className={`w-2 h-2 rounded-full ${isOnShift ? "bg-status-good-500" : "bg-status-bad-500"} animate-pulse flex-shrink-0`} />
              </h1>
              <p className="hidden sm:block text-xs text-text-secondary font-semibold truncate">
                {t("cashier.registerToday")} · {formatEGP(dayRevenue)} {t("common.egp")} {t("cashier.todaySuffix")}
              </p>
            </div>

            <ClockButton staffId={staff.id} name={staff.name} role={staff.role} />
            {/* Always-visible language toggle (compact for mobile). */}
            <LanguageToggle
              lang={lang}
              onToggle={toggleLang}
              className="h-8 px-2.5 rounded-xl text-[11px] font-bold bg-sand-100 text-text-secondary hover:bg-sand-200 transition active:scale-95"
            />

            {/* Desktop: inline buttons. Mobile: kebab dropdown. */}
            <div className="hidden sm:flex items-center gap-1.5">
              <button onClick={() => setShowSchedule(true)} className="p-2 hover:bg-sand-100 rounded-xl transition" title={t("cashier.mySchedule")}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              </button>
              <button
                onClick={onLogout}
                className="inline-flex items-center gap-1.5 px-3 h-8 rounded-xl bg-sand-100 text-text-secondary hover:bg-status-bad-100 hover:text-status-bad-600 text-[11px] font-bold uppercase tracking-wider transition"
                title={t("cashier.logOut")}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                {t("cashier.logout")}
              </button>
            </div>

            {/* Mobile kebab */}
            <CashierHeaderMenu
              onOpenSchedule={() => setShowSchedule(true)}
              onLogout={onLogout}
              lang={lang}
              onToggleLang={toggleLang}
            />
          </div>

          {/* Mobile-only: today's total as its own slim chip so it stays visible */}
          <p className="sm:hidden text-[11px] text-text-secondary font-semibold mb-2 truncate">
            {t("cashier.registerToday")}: <span className="text-text-primary font-semibold tabular-nums">{formatEGP(dayRevenue)} {t("common.egp")}</span>
          </p>

          {staff.shift !== 0 && (
            <div className={`flex items-center justify-between px-3 py-2 rounded-xl ${
              isOnShift ? "bg-status-good-50 border border-status-good-200" : "bg-status-bad-50 border border-status-bad-200"
            }`}>
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-2 h-2 rounded-full ${isOnShift ? "bg-status-good-500" : "bg-status-bad-500"} animate-pulse flex-shrink-0`} />
                <span className={`text-[11px] sm:text-xs font-bold truncate ${isOnShift ? "text-status-good-700" : "text-status-bad-700"}`}>
                  {getShiftLabel(staff.shift, "CASHIER")}
                </span>
              </div>
              <span className={`text-xs sm:text-sm font-semibold tabular-nums flex-shrink-0 ${isOnShift ? "text-status-good-800" : "text-status-bad-800"}`}>
                {shiftInfo.label}
              </span>
            </div>
          )}
        </div>
      </header>
      {showSchedule && <SchedulePopup staffId={staff.id} role={staff.role} onClose={() => setShowSchedule(false)} />}

      {/* New-version banner — server has rolled forward while this tab
          has been open. Cashier can reload manually; otherwise the
          reliability hook auto-reloads after 60s of idle. */}
      {newVersion && (
        <div className="max-w-5xl mx-auto px-6 pt-4">
          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-status-warn-50 border-2 border-status-warn-300">
            <div className="w-9 h-9 rounded-xl bg-status-warn-500 text-white flex items-center justify-center text-lg shrink-0">
              ↻
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-status-warn-900">{t("cashier.newVersionAvailable")}</p>
              <p className="text-[11px] text-status-warn-700 font-semibold">
                {t("cashier.reloadWhenIdle")}
              </p>
            </div>
            <button
              onClick={reloadNow}
              className="px-4 py-2 rounded-xl bg-status-warn-600 text-white text-xs font-semibold active:scale-95"
            >
              {t("cashier.reloadNow")}
            </button>
          </div>
        </div>
      )}

      {/* Main — on mobile, payment panel sits first (it's the primary job).
          On desktop the 1/3 sidebar layout takes over with stats on left. */}
      <main className="max-w-5xl mx-auto px-3 sm:px-6 pt-4 sm:pt-6 pb-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Payment panel — primary action */}
          <div className="lg:col-span-2 lg:order-2">
            <AcceptPaymentPanel
              sessions={sessions}
              onAcceptPayment={handleAcceptPayment}
              onReversePayment={handleReversePayment}
              recentlyPaidSessions={recentlyPaid}
              busyRef={busyRef}
              staffId={staff.id}
            />
          </div>
          {/* Stats column — below the fold on mobile, left on desktop */}
          <div className="lg:col-span-1 lg:order-1 space-y-4 sm:space-y-6">
            <DrawerPanel restaurantId={restaurantSlug} cashierId={staff.id} />
            <ShiftSummary
              shiftRevenue={shiftRevenue}
              shiftOrders={shiftOrders}
              cashCollected={cashCollected}
              cardCollected={cardCollected}
              dayRevenue={dayRevenue}
              activeSessions={sessions}
            />
            <TipsCounter
              todayTips={dayTips}
              shiftTips={shiftTips}
              todayRevenue={dayRevenue}
              waiters={shiftTipsByWaiter}
              compact
            />
          </div>
        </div>
      </main>
    </div>
  );
}

// Kebab dropdown for mobile header — holds schedule, language toggle,
// logout. Visible only below sm; desktop inlines the same actions.
function CashierHeaderMenu({
  onOpenSchedule,
  onLogout,
  lang,
  onToggleLang,
}: {
  onOpenSchedule: () => void;
  onLogout: () => void;
  lang: string;
  onToggleLang: () => void;
}) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onClick = () => setOpen(false);
    window.addEventListener("keydown", onKey);
    const ti = setTimeout(() => window.addEventListener("click", onClick), 0);
    return () => {
      clearTimeout(ti);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onClick);
    };
  }, [open]);

  return (
    <div className="sm:hidden relative" onClick={(e) => e.stopPropagation()}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-9 h-9 rounded-xl bg-sand-100 text-text-secondary flex items-center justify-center hover:bg-sand-200 transition"
        title={t("common.more") || "More"}
        aria-label="More actions"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>
      </button>
      {open && (
        <div className="absolute end-0 top-11 z-50 w-52 rounded-xl border border-sand-200 bg-white shadow-lg py-1">
          <button
            onClick={() => { setOpen(false); onOpenSchedule(); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-sand-50 transition"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-text-secondary"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <span className="text-[12px] font-bold text-text-secondary">{t("cashier.mySchedule")}</span>
          </button>
          <button
            onClick={() => { onToggleLang(); setOpen(false); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-sand-50 transition"
          >
            <span className="w-3.5 h-3.5 inline-flex items-center justify-center text-[9px] font-semibold text-text-secondary bg-sand-100 rounded">ع</span>
            <span className="text-[12px] font-bold text-text-secondary">{lang === "ar" ? "English" : "العربية"}</span>
          </button>
          <div className="border-t border-sand-100 mt-1 pt-1">
            <button
              onClick={() => { setOpen(false); onLogout(); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-status-bad-50 transition"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="text-status-bad-500">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span className="text-[12px] font-bold text-status-bad-600">{t("cashier.logout")}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
