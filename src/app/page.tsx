"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const RESTAURANT_SLUG = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";
const STAFF_PIN = process.env.NEXT_PUBLIC_STAFF_PIN || "";
const UNLOCK_KEY = "ttc_staff_unlocked";

export default function Home() {
  const [unlocked, setUnlocked] = useState(false);
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(UNLOCK_KEY) === "1") setUnlocked(true);
    } catch {}
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin === STAFF_PIN) {
      setUnlocked(true);
      try { sessionStorage.setItem(UNLOCK_KEY, "1"); } catch {}
    } else {
      setError(true);
      setPin("");
      setTimeout(() => setError(false), 800);
    }
  };

  return (
    <div className="min-h-dvh bg-beach relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 left-0 right-0 h-96 bg-gradient-to-b from-ocean-100/30 via-ocean-50/10 to-transparent" />
      <div className="absolute -top-32 -right-32 w-80 h-80 rounded-full bg-ocean-200/15 blur-3xl" />
      <div className="absolute bottom-0 -left-32 w-80 h-80 rounded-full bg-sunset-400/10 blur-3xl" />
      <div className="absolute top-1/2 right-0 w-40 h-40 rounded-full bg-coral-200/10 blur-2xl" />

      <div className="relative flex flex-col items-center justify-center min-h-dvh px-6 py-12">
        {/* Logo + Brand */}
        <div className="text-center mb-12">
          <div className="relative inline-flex mb-6">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-ocean-400 to-ocean-600 flex items-center justify-center shadow-lg">
              <span className="text-3xl text-white font-extrabold tracking-tight">T</span>
            </div>
            <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-status-good-400 border-[3px] border-[#fefdfb] animate-pulse" />
          </div>
          <h1 className="text-3xl font-extrabold text-text-primary mb-2 tracking-tight">
            Table to Cash
          </h1>
          <p className="text-text-secondary text-sm max-w-xs mx-auto leading-relaxed">
            Real-time revenue optimization engine for coastal restaurants
          </p>
        </div>

        {/* Experience Cards — gated behind staff PIN */}
        <div className="w-full max-w-sm space-y-3 mb-10">
          {!unlocked ? (
            <form onSubmit={handleSubmit} className="block">
              <div className="relative overflow-hidden rounded-2xl bg-white border-2 border-sand-200 p-6 shadow-sm">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-sand-100 flex items-center justify-center text-2xl flex-shrink-0">
                    🔒
                  </div>
                  <div className="flex-1">
                    <h2 className="text-text-primary font-bold text-base">Enter Access PIN</h2>
                    <p className="text-text-muted text-xs">8-digit code to view the app</p>
                  </div>
                </div>
                <input
                  autoFocus
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={9}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="••••••••"
                  className={`w-full px-4 py-3 rounded-xl border-2 text-center text-lg font-bold tracking-widest focus:outline-none transition-colors ${
                    error ? "border-status-bad-400 bg-status-bad-50 text-status-bad-600" : "border-sand-200 bg-sand-50 text-text-primary focus:border-ocean-400"
                  }`}
                />
                <button
                  type="submit"
                  className="w-full mt-3 py-3 rounded-xl bg-ocean-600 text-white font-bold text-sm active:scale-[0.98] transition"
                >
                  Unlock
                </button>
              </div>
            </form>
          ) : (
            <>
              {/* Customer */}
              <Link href={`/scan?table=7&name=Neom+Dahab&slug=${RESTAURANT_SLUG}`} className="block group">
                <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-ocean-500 to-ocean-600 p-5 shadow-lg transition-all active:scale-[0.98]">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-8 translate-x-8" />
                  <div className="relative flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-white/20 flex items-center justify-center text-2xl flex-shrink-0">
                      📱
                    </div>
                    <div>
                      <h2 className="text-white font-bold text-base">Customer Experience</h2>
                      <p className="text-white/70 text-xs">Scan, browse, order — as a guest sees it</p>
                    </div>
                    <span className="text-white/40 text-lg ml-auto">→</span>
                  </div>
                </div>
              </Link>

              {/* Owner Dashboard */}
              <Link href="/dashboard" className="block group">
                <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-sand-700 to-sand-800 p-5 shadow-lg transition-all active:scale-[0.98]">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -translate-y-8 translate-x-8" />
                  <div className="relative flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-white/15 flex items-center justify-center text-2xl flex-shrink-0">
                      🧠
                    </div>
                    <div>
                      <h2 className="text-white font-bold text-base">Restaurant Brain</h2>
                      <p className="text-white/60 text-xs">Live intelligence, floor view, controls</p>
                    </div>
                    <span className="text-white/30 text-lg ml-auto">→</span>
                  </div>
                </div>
              </Link>

              {/* Waiter */}
              <Link href="/waiter" className="block group">
                <div className="relative overflow-hidden rounded-2xl bg-white border-2 border-sand-200 p-5 shadow-sm transition-all active:scale-[0.98]">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-sand-100 flex items-center justify-center text-2xl flex-shrink-0">
                      🧑‍🍳
                    </div>
                    <div>
                      <h2 className="text-text-primary font-bold text-base">Waiter</h2>
                      <p className="text-text-muted text-xs">Orders, tables, service</p>
                    </div>
                    <span className="text-text-muted/40 text-lg ml-auto">→</span>
                  </div>
                </div>
              </Link>

              {/* Kitchen */}
              <Link href="/kitchen" className="block group">
                <div className="relative overflow-hidden rounded-2xl bg-white border-2 border-sand-200 p-5 shadow-sm transition-all active:scale-[0.98]">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-sand-100 flex items-center justify-center text-2xl flex-shrink-0">
                      🍳
                    </div>
                    <div>
                      <h2 className="text-text-primary font-bold text-base">Kitchen</h2>
                      <p className="text-text-muted text-xs">Prep queue, station loads</p>
                    </div>
                    <span className="text-text-muted/40 text-lg ml-auto">→</span>
                  </div>
                </div>
              </Link>

              {/* Bar */}
              <Link href="/bar" className="block group">
                <div className="relative overflow-hidden rounded-2xl bg-white border-2 border-sand-200 p-5 shadow-sm transition-all active:scale-[0.98]">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-sand-100 flex items-center justify-center text-2xl flex-shrink-0">
                      🍹
                    </div>
                    <div>
                      <h2 className="text-text-primary font-bold text-base">Bar</h2>
                      <p className="text-text-muted text-xs">Drink queue, pour stations</p>
                    </div>
                    <span className="text-text-muted/40 text-lg ml-auto">→</span>
                  </div>
                </div>
              </Link>

              {/* Floor Manager */}
              <Link href="/floor" className="block group">
                <div className="relative overflow-hidden rounded-2xl bg-white border-2 border-sand-200 p-5 shadow-sm transition-all active:scale-[0.98]">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-ocean-100 flex items-center justify-center text-2xl flex-shrink-0">
                      📋
                    </div>
                    <div>
                      <h2 className="text-text-primary font-bold text-base">Floor Manager</h2>
                      <p className="text-text-muted text-xs">Alerts, staff, table operations</p>
                    </div>
                    <span className="text-text-muted/40 text-lg ml-auto">→</span>
                  </div>
                </div>
              </Link>

              {/* Delivery */}
              <Link href="/delivery" className="block group">
                <div className="relative overflow-hidden rounded-2xl bg-white border-2 border-sand-200 p-5 shadow-sm transition-all active:scale-[0.98]">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-status-warn-100 flex items-center justify-center text-2xl flex-shrink-0">
                      &#x1F6F5;
                    </div>
                    <div>
                      <h2 className="text-text-primary font-bold text-base">Delivery</h2>
                      <p className="text-text-muted text-xs">VIP deliveries, routes</p>
                    </div>
                    <span className="text-text-muted/40 text-lg ml-auto">&rarr;</span>
                  </div>
                </div>
              </Link>

              {/* Cashier */}
              <Link href="/cashier" className="block group">
                <div className="relative overflow-hidden rounded-2xl bg-white border-2 border-sand-200 p-5 shadow-sm transition-all active:scale-[0.98]">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-sand-100 flex items-center justify-center text-2xl flex-shrink-0">
                      💳
                    </div>
                    <div>
                      <h2 className="text-text-primary font-bold text-base">Cashier</h2>
                      <p className="text-text-muted text-xs">Confirm payments, close checks</p>
                    </div>
                    <span className="text-text-muted/40 text-lg ml-auto">→</span>
                  </div>
                </div>
              </Link>
            </>
          )}
        </div>

        {/* Status footer */}
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center gap-2 text-xs text-text-muted">
            <span className="w-2 h-2 rounded-full bg-status-good-400 animate-pulse" />
            System live
          </div>
          <p className="text-[11px] text-text-muted/60">
            Dahab, Egypt
          </p>
        </div>
      </div>
    </div>
  );
}
