"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { RESTAURANT_SLUG } from "@/lib/restaurant-config";
import { useLanguage } from "@/lib/use-language";
import type { LoggedInStaff } from "./types";

export function FloorLoginScreen({ onLogin }: { onLogin: (staff: LoggedInStaff) => void }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { t } = useLanguage();

  const handleSubmit = async () => {
    if (pin.length < 4) { setError(t("floor.enterPin")); return; }
    setError(""); setLoading(true);
    try {
      const res = await fetch("/api/staff/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin, restaurantId: RESTAURANT_SLUG }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || t("floor.invalidPin"));
        setLoading(false);
        return;
      }
      const staff = await res.json();
      if (staff.role !== "FLOOR_MANAGER" && staff.role !== "OWNER") {
        setError(t("floor.floorManagerOnly"));
        setLoading(false);
        return;
      }
      onLogin({ ...staff, loginAt: Date.now() });
    } catch {
      setError(t("floor.networkError"));
    }
    setLoading(false);
  };

  const handleKey = (d: string) => { if (pin.length < 6) { setPin((p) => p + d); setError(""); } };
  const handleBack = () => setPin((p) => p.slice(0, -1));

  return (
    <div className="min-h-dvh bg-sand-100 flex items-center justify-center px-4">
      <motion.div className="w-full max-w-sm bg-white rounded-3xl shadow-xl p-8" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-ocean-600 flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl text-white font-semibold">F</span>
          </div>
          <h1 className="text-xl font-semibold text-text-primary">{t("floor.title")}</h1>
          <p className="text-sm text-text-secondary mt-1">{t("floor.loginDesc")}</p>
        </div>

        <div className="flex justify-center gap-3 mb-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`w-12 h-14 rounded-xl border-2 flex items-center justify-center text-xl font-semibold transition-all ${pin.length > i ? "border-ocean-600 bg-ocean-50 text-ocean-900" : "border-sand-200 bg-white text-transparent"}`}>
              {pin.length > i ? "\u25CF" : "\u25CB"}
            </div>
          ))}
        </div>

        {error && <p className="text-status-bad-600 text-xs font-bold text-center mb-4">{error}</p>}

        <div className="grid grid-cols-3 gap-2 mb-4">
          {["1","2","3","4","5","6","7","8","9","","0",""].map((d, i) => d ? (
            <button key={i} onClick={() => handleKey(d)} className="h-14 rounded-xl bg-sand-50 border border-sand-200 text-lg font-semibold text-text-primary active:bg-sand-200 transition">{d}</button>
          ) : i === 9 ? <div key={i} /> : (
            <button key={i} onClick={handleBack} className="h-14 rounded-xl bg-sand-50 border border-sand-200 text-sm font-bold text-text-secondary active:bg-sand-200 transition">&larr;</button>
          ))}
        </div>

        <button onClick={handleSubmit} disabled={loading || pin.length < 4} className="w-full py-3.5 rounded-xl bg-ocean-600 text-white font-bold text-sm disabled:opacity-40 active:scale-[0.98] transition">
          {loading ? t("floor.loggingIn") : t("floor.logIn")}
        </button>
      </motion.div>
    </div>
  );
}
