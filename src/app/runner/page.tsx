"use client";

// ═══════════════════════════════════════════════════════════════════
// RUNNER SCREEN
//
// The shared pickup queue. Replaces the per-waiter app on restaurants
// running in RUNNER service mode. Every kitchen/bar dish that hits
// READY shows up here for whichever runner is closest. Tap "I've got
// it" → marks the order SERVED and removes the row.
//
// Designed for a phone in a runner's apron pocket OR a wall-mounted
// tablet at the pass (same screen, both contexts).
//
// Switchback story: the moment the owner flips serviceModel back to
// WAITER, login routing in /waiter sends staff to the legacy app
// instead. /runner stays compiled; nothing here breaks.
// ═══════════════════════════════════════════════════════════════════

import { useEffect, useState, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { usePerception, type LiveOrder } from "@/lib/engine/perception";
import { useLiveData } from "@/lib/use-live-data";
import { useLanguage } from "@/lib/use-language";
import { LanguageToggle } from "@/presentation/components/ui/LanguageToggle";
import { staffFetch } from "@/lib/staff-fetch";
import { ClockButton } from "@/presentation/components/ui/ClockButton";
import { getShiftTimer } from "@/lib/shifts";

type LoggedInStaff = {
  id: string;
  name: string;
  role: string;
  shift: number;
  serviceModel?: "WAITER" | "RUNNER";
  isCaptain?: boolean;
};

const RESTAURANT_SLUG = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";

// ─── Login ─────────────────────────────────────────────────────────
// Mirror the existing waiter PIN flow, but redirect captains and
// (in WAITER mode) regular waiters to the legacy /waiter app — they
// don't belong on the runner queue.

function RunnerLogin({ onLogin }: { onLogin: (staff: LoggedInStaff) => void }) {
  const { t } = useLanguage();
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (pin.length < 4) { setError(t("login.pinTooShort")); return; }
    setError(""); setLoading(true);
    try {
      const res = await fetch("/api/staff/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, restaurantId: RESTAURANT_SLUG }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || t("login.invalidPin"));
        setLoading(false);
        return;
      }
      const staff: LoggedInStaff = await res.json();
      // Wrong-mode redirects: a captain or a WAITER-mode session
      // belongs on /waiter, not here. Avoids two parallel apps
      // showing the same staff member with different UIs.
      if (staff.serviceModel === "WAITER" || staff.isCaptain) {
        window.location.href = "/waiter";
        return;
      }
      if (staff.role !== "WAITER" && staff.role !== "RUNNER") {
        setError(t("login.invalidPin"));
        setLoading(false);
        return;
      }
      onLogin(staff);
    } catch {
      setError(t("login.networkError"));
    }
    setLoading(false);
  };

  const handleKey = (k: string) => {
    if (k === "⌫") setPin((p) => p.slice(0, -1));
    else if (k && pin.length < 6) { setPin((p) => p + k); setError(""); }
  };

  return (
    <div className="min-h-dvh bg-sand-100 flex items-center justify-center px-4">
      <motion.div
        className="w-full max-w-sm bg-white rounded-3xl shadow-xl p-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-status-good-600 flex items-center justify-center mx-auto mb-4 text-2xl text-white">
            🏃
          </div>
          <h1 className="text-xl font-semibold text-text-primary">{t("runner.loginTitle")}</h1>
          <p className="text-sm text-text-secondary mt-1">{t("runner.loginDesc")}</p>
        </div>
        <div className="flex justify-center gap-3 mb-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`w-12 h-14 rounded-xl border-2 flex items-center justify-center text-xl font-semibold transition-all ${
              pin.length > i ? "border-status-good-600 bg-status-good-50 text-status-good-900" : "border-sand-200 bg-white text-transparent"
            }`}>
              {pin.length > i ? "●" : "○"}
            </div>
          ))}
        </div>
        {error && (
          <p className="text-center text-status-bad-600 text-sm font-semibold mb-4">{error}</p>
        )}
        <div className="grid grid-cols-3 gap-2 mb-6">
          {["1","2","3","4","5","6","7","8","9","","0","⌫"].map((k) => (
            <button key={k || "blank"} onClick={() => handleKey(k)} disabled={!k}
              className={`h-14 rounded-xl text-xl font-bold transition active:scale-95 ${
                k === "⌫" ? "bg-sand-100 text-text-secondary" : k ? "bg-sand-50 text-text-primary hover:bg-sand-100" : "invisible"
              }`}>{k}</button>
          ))}
        </div>
        <button onClick={handleSubmit} disabled={pin.length < 4 || loading}
          className={`w-full py-4 rounded-2xl text-lg font-bold transition ${
            pin.length >= 4 && !loading ? "bg-status-good-600 text-white hover:bg-status-good-700" : "bg-sand-200 text-text-muted cursor-not-allowed"
          }`}
        >{loading ? t("login.verifying") : t("runner.login")}</button>
      </motion.div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────

function ageMins(ts: number): number {
  return Math.max(0, Math.floor((Date.now() - ts) / 60000));
}

function ageColor(mins: number): { bg: string; text: string; label: string } {
  if (mins >= 5) return { bg: "bg-status-bad-100", text: "text-status-bad-700", label: "URGENT" };
  if (mins >= 2) return { bg: "bg-status-warn-100", text: "text-status-warn-700", label: "WAITING" };
  return { bg: "bg-status-good-100", text: "text-status-good-700", label: "FRESH" };
}

// ─── Pickup card ───────────────────────────────────────────────────

function PickupCard({
  order,
  busy,
  onTake,
}: {
  order: LiveOrder;
  busy: boolean;
  onTake: () => void;
}) {
  const { t } = useLanguage();
  // Age is computed from readyAt (when kitchen marked READY) when
  // available, otherwise from createdAt as a fallback. The bar that
  // matters for runner SLA is "how long has this been sitting at
  // the pass," not "how long since the guest ordered."
  const refTs = order.readyAt ?? order.createdAt;
  const mins = ageMins(refTs);
  const age = ageColor(mins);
  const tableLabel = order.tableNumber != null ? `T${order.tableNumber}` : "VIP";
  const guestLabel = order.guestName?.trim() || (order.guestNumber ? `${t("runner.guest")} ${order.guestNumber}` : null);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, x: 100 }}
      transition={{ type: "spring", damping: 20 }}
      className="bg-white rounded-2xl border-2 border-sand-200 overflow-hidden shadow-sm"
    >
      <div className={`px-4 py-2 flex items-center justify-between ${age.bg}`}>
        <div className={`text-[11px] font-extrabold tracking-wider ${age.text}`}>
          {age.label}
        </div>
        <div className={`text-[11px] font-bold tabular-nums ${age.text}`}>
          {mins === 0 ? t("runner.justReady") : `${mins}m`}
        </div>
      </div>
      <div className="px-5 pt-4 pb-3 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-3xl font-extrabold text-text-primary leading-none">{tableLabel}</span>
            {guestLabel && (
              <span className="text-[12px] font-bold text-text-secondary truncate">{guestLabel}</span>
            )}
          </div>
          <div className="text-[10px] font-bold text-text-muted uppercase tracking-wider">
            #{order.orderNumber}
          </div>
        </div>
      </div>
      <ul className="px-5 pb-3 space-y-1">
        {order.items.map((it, idx) => (
          <li key={`${it.id}-${idx}`} className="flex items-center justify-between gap-3">
            <span className={`text-sm ${it.cancelled ? "line-through text-text-muted" : "text-text-secondary"}`}>
              {it.quantity > 1 && <span className="font-bold">{it.quantity}× </span>}
              {it.name}
            </span>
          </li>
        ))}
      </ul>
      {/* Allergy / notes flag bar — picks up anything the guest typed
          on /track or that the menu item carried. Surfaces it loud so
          the runner double-checks the dish at the pass. */}
      {order.notes && (
        <div className="mx-5 mb-3 px-3 py-2 rounded-lg bg-status-warn-50 border border-status-warn-200">
          <div className="text-[10px] font-extrabold text-status-warn-700 uppercase tracking-wider mb-0.5">
            {t("runner.note")}
          </div>
          <div className="text-xs font-semibold text-status-warn-900">{order.notes}</div>
        </div>
      )}
      <div className="px-5 pb-4">
        <button
          onClick={onTake}
          disabled={busy}
          className="w-full py-4 rounded-2xl bg-status-good-600 text-white text-base font-bold active:scale-95 disabled:opacity-50 transition"
        >
          {busy ? "…" : `✓ ${t("runner.gotIt")}`}
        </button>
      </div>
    </motion.div>
  );
}

// ─── Main runner system ───────────────────────────────────────────

function RunnerSystem({ staff, onLogout }: { staff: LoggedInStaff; onLogout: () => void }) {
  const { t, dir, lang, toggleLang } = useLanguage();
  useLiveData(staff.id);
  const allOrders = usePerception((s) => s.orders);

  // The runner's queue: anything currently READY for pickup, regardless
  // of station. Sort: oldest first (the dish that's been sitting
  // longest gets picked up next). Re-evaluates every tick because the
  // age coloring depends on real-time.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const readyQueue = useMemo(() => {
    const items = allOrders.filter((o) => o.status === "ready");
    return items.sort((a, b) => (a.readyAt ?? a.createdAt) - (b.readyAt ?? b.createdAt));
  }, [allOrders, now]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bell on new READY items. Plays a short chime each time the queue
  // grows. We track size with a ref so a mount or a refresh-poll
  // doesn't fire a chime for every existing item.
  const lastSizeRef = useRef(0);
  useEffect(() => {
    const grew = readyQueue.length > lastSizeRef.current;
    lastSizeRef.current = readyQueue.length;
    if (!grew) return;
    try {
      // Browser audio APIs are gated on user interaction. The first
      // chime after login may be silent on some browsers; that's OK.
      // Subsequent chimes work after any tap on the page.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880; // A5
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch { /* silent */ }
  }, [readyQueue.length]);

  // Per-order "I've got it" busy flag so two simultaneous taps don't
  // double-fire the SERVED PATCH (idempotent server-side anyway, but
  // visually we want one runner to win).
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleTake = async (orderId: string) => {
    if (busyOrderId) return;
    setBusyOrderId(orderId);
    setError(null);
    try {
      const res = await staffFetch(staff.id, `/api/orders/${orderId}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: "SERVED", restaurantId: RESTAURANT_SLUG }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error || t("runner.takeFailed"));
      }
    } catch {
      setError(t("runner.networkError"));
    }
    setBusyOrderId(null);
  };

  const shiftInfo = getShiftTimer(staff.shift, staff.role);

  return (
    <div className="min-h-dvh bg-sand-50" dir={dir}>
      {/* Header */}
      <header className="bg-white border-b border-sand-200 sticky top-0 z-10">
        <div className="px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-base font-extrabold text-text-primary truncate">
              {t("runner.title")}
            </h1>
            <p className="text-[11px] font-semibold text-text-secondary">
              {staff.name} · {shiftInfo.label}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ClockButton staffId={staff.id} role={staff.role} />
            <LanguageToggle lang={lang} onToggle={toggleLang} />
            <button onClick={onLogout}
              className="px-3 py-2 rounded-xl bg-sand-100 text-text-secondary text-xs font-bold active:scale-95">
              {t("runner.logout")}
            </button>
          </div>
        </div>
        {/* Live count strip */}
        <div className="px-4 py-2 bg-sand-50 border-t border-sand-200 flex items-center justify-between">
          <div className="text-[11px] font-extrabold text-text-muted uppercase tracking-wider">
            {t("runner.queue")}
          </div>
          <div className={`text-sm font-extrabold tabular-nums ${
            readyQueue.length === 0 ? "text-text-muted" :
            readyQueue.length >= 5 ? "text-status-bad-600" :
            readyQueue.length >= 3 ? "text-status-warn-600" :
            "text-status-good-600"
          }`}>
            {readyQueue.length} {readyQueue.length === 1 ? t("runner.dish") : t("runner.dishes")}
          </div>
        </div>
      </header>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mt-3 px-4 py-3 rounded-xl bg-status-bad-50 border border-status-bad-200 flex items-center justify-between">
          <p className="text-sm font-bold text-status-bad-700">{error}</p>
          <button onClick={() => setError(null)} className="text-status-bad-600 text-lg">×</button>
        </div>
      )}

      {/* Queue */}
      <main className="px-4 py-4 space-y-3 max-w-2xl mx-auto">
        {readyQueue.length === 0 ? (
          <div className="bg-white rounded-2xl border-2 border-dashed border-sand-200 p-12 text-center">
            <div className="text-5xl mb-3 opacity-40">🍽️</div>
            <p className="text-sm font-bold text-text-secondary">{t("runner.empty")}</p>
            <p className="text-[11px] text-text-muted mt-1">{t("runner.emptyHint")}</p>
          </div>
        ) : (
          <AnimatePresence>
            {readyQueue.map((order) => (
              <PickupCard
                key={order.id}
                order={order}
                busy={busyOrderId === order.id}
                onTake={() => handleTake(order.id)}
              />
            ))}
          </AnimatePresence>
        )}
      </main>
    </div>
  );
}

// ─── Page entry ───────────────────────────────────────────────────

export default function RunnerPage() {
  const [staff, setStaff] = useState<LoggedInStaff | null>(null);

  useEffect(() => {
    // Pick up a previously logged-in runner from sessionStorage so a
    // tablet at the pass doesn't re-auth on every accidental refresh.
    try {
      const raw = sessionStorage.getItem("ttc_runner_staff");
      if (raw) setStaff(JSON.parse(raw));
    } catch { /* silent */ }
  }, []);

  const handleLogin = (s: LoggedInStaff) => {
    setStaff(s);
    try { sessionStorage.setItem("ttc_runner_staff", JSON.stringify(s)); } catch {}
  };
  const handleLogout = () => {
    setStaff(null);
    try { sessionStorage.removeItem("ttc_runner_staff"); } catch {}
  };

  if (!staff) return <RunnerLogin onLogin={handleLogin} />;
  return <RunnerSystem staff={staff} onLogout={handleLogout} />;
}
