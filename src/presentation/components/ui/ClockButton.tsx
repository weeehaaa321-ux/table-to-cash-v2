"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLanguage } from "@/lib/use-language";
import { RESTAURANT_TZ } from "@/lib/restaurant-config";

// Clock-in / clock-out control for staff role pages.
//
// Two modes, depending on current clock state:
//   out   → renders a full-screen blurred gate overlay with a big
//           centered "Clock In" button. The role view is visible
//           through the blur but unreachable until they clock in.
//   in    → renders the compact header pill that shows elapsed time
//           and lets the staff member clock out.
//
// This turns clock-in from a decorative timesheet into a real gate:
// you can't work the floor without being on the clock.
export function ClockButton({
  staffId,
  name,
  role,
}: {
  staffId: string;
  name?: string;
  role?: string;
}) {
  const { t, lang, dir } = useLanguage();
  const [state, setState] = useState<"loading" | "in" | "out">("loading");
  const [since, setSince] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Portal target only resolves after mount (document is undefined on
  // SSR). Without this guard, the gate flashes inline for one paint
  // before portaling on hydration.
  useEffect(() => { setMounted(true); }, []);

  // Tick every 30s — enough resolution for the elapsed pill and live
  // wall-clock on the gate without burning render budget.
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);

  const refresh = async () => {
    try {
      const res = await fetch(`/api/clock?staffId=${staffId}`);
      if (!res.ok) { setState("out"); return; }
      const data = await res.json();
      if (data.open) {
        setState("in");
        setSince(new Date(data.open.clockIn));
      } else {
        setState("out");
        setSince(null);
      }
    } catch {
      setState("out");
    }
  };

  useEffect(() => { refresh(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [staffId]);

  const toggle = async () => {
    if (busy || state === "loading") return;
    setBusy(true);
    setError(null);
    try {
      const action = state === "in" ? "out" : "in";
      const res = await fetch("/api/clock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId, action }),
      });
      if (res.ok) {
        await refresh();
      } else {
        setError(t("clock.tryAgain"));
      }
    } catch {
      setError(t("clock.networkError"));
    }
    setBusy(false);
  };

  // Don't render an inline placeholder while loading — the gate slams
  // in from nowhere if we render a tiny "…" first. Render nothing,
  // wait for the fetch.
  if (state === "loading") return null;

  // ── Gate mode: staff is not clocked in ─────────────────────
  if (state === "out") {
    // Don't render the gate until we're past hydration. ClockButton is
    // mounted inside a header that has `backdrop-filter: blur` on it,
    // and `backdrop-filter` on a parent makes that parent the
    // containing block for any `position: fixed` descendant. The gate
    // would only cover the header's box, leaving the rest of the page
    // interactive underneath. Portaling to <body> escapes the
    // containing block so `inset-0` is finally relative to the
    // viewport.
    if (!mounted) return null;

    const firstName = name ? name.split(" ")[0] : "";
    const roleKey = role ? roleI18nKey(role) : null;
    const roleLabel = roleKey ? t(roleKey) : "";
    const wallClock = formatWallClock(now, lang);

    const gate = (
      <div
        dir={dir}
        className="z-[2147483647] animate-fade-in"
        style={{
          // Explicit dimensions + top/left instead of inset-0. Some
          // mobile browsers (and Safari with quirky ancestors) handle
          // inset-0 inconsistently when fixed positioning involves
          // dvh / safe-area math. width:100vw + height:100dvh is
          // unambiguous.
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100dvh",
          // Center using flex on the gate itself rather than nested
          // text-center + mx-auto on each child — that pattern was
          // shifting visually on tablet portrait widths because the
          // role pill (inline-flex) and the 192px button were being
          // centered by different mechanisms.
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // Opaque-enough fallback in case backdrop-filter is throttled
          // or unsupported (older WebViews). The gradient is solid;
          // backdrop-filter just sweetens it on capable browsers.
          background:
            "linear-gradient(135deg, rgba(255,245,235,0.92) 0%, rgba(224,242,254,0.92) 100%)",
          backdropFilter: "blur(28px) saturate(1.4)",
          WebkitBackdropFilter: "blur(28px) saturate(1.4)",
        }}
      >
        {/* Inner stack: flex-col + items-center centres every direct
            child along the cross axis regardless of width / inline-block
            quirks. text-center remains for inline text within blocks. */}
        <div className="flex flex-col items-center w-full max-w-md px-6 text-center">
          {/* Live wall-clock — anchors the screen and confirms the device clock matches the restaurant tz */}
          <div className="text-[10px] font-extrabold uppercase tracking-[0.25em] text-text-muted mb-1.5">
            {t("clock.now")}
          </div>
          <div className="text-5xl font-extrabold text-text-primary tabular-nums tracking-tight leading-none mb-8">
            {wallClock}
          </div>

          {/* Welcome name — the actual greeting */}
          <div className="mb-1 text-xs font-extrabold uppercase tracking-[0.2em] text-text-secondary">
            {t("clock.welcome")}
          </div>
          <div className="text-3xl font-extrabold text-text-primary tracking-tight leading-tight mb-2">
            {firstName || t("clock.welcomeNoName")}
          </div>
          {roleLabel ? (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sand-100 border border-sand-200 text-text-secondary text-[11px] font-extrabold uppercase tracking-widest mb-10">
              {roleLabel}
            </div>
          ) : (
            <div className="mb-10" />
          )}

          <button
            onClick={toggle}
            disabled={busy}
            className={`group relative w-52 h-52 rounded-full flex flex-col items-center justify-center mb-6 bg-status-good-500 shadow-[0_20px_60px_rgba(16,185,129,0.35)] transition-all active:scale-95 ${
              busy ? "opacity-75" : "hover:bg-status-good-600 hover:shadow-[0_25px_70px_rgba(16,185,129,0.45)]"
            }`}
          >
            <span className="absolute inset-0 rounded-full bg-white/10 group-active:bg-black/10 transition-colors" />
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-12 h-12 text-white mb-2"
            >
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span className="text-white font-extrabold text-xl tracking-wider uppercase">
              {busy ? t("clock.starting") : t("clock.clockIn")}
            </span>
          </button>
          <p className="text-xs text-text-secondary leading-relaxed max-w-[18rem]">
            {t("clock.unlockMessage")}
          </p>
          {error && (
            <p className="mt-3 text-xs font-extrabold text-status-bad-600">{error}</p>
          )}
        </div>
      </div>
    );

    return createPortal(gate, document.body);
  }

  // ── Pill mode: clocked in, show elapsed time + clock-out ───
  const elapsedMin = since ? Math.max(0, Math.round((now - since.getTime()) / 60000)) : 0;
  const h = Math.floor(elapsedMin / 60);
  const m = elapsedMin % 60;
  const elapsedLabel = h > 0 ? `${h}h ${m}m` : `${m}m`;

  return (
    <button
      onClick={toggle}
      disabled={busy}
      title={t("clock.clockOut")}
      className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-xl text-[11px] font-extrabold uppercase tracking-wider transition active:scale-95 bg-status-good-100 text-status-good-700 hover:bg-status-good-200 ${
        busy ? "opacity-50" : ""
      }`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-status-good-500 animate-pulse" />
      {t("clock.on")} · <span className="tabular-nums">{elapsedLabel}</span>
    </button>
  );
}

// Map raw role enum to the existing dashboard.role.* i18n key surface.
function roleI18nKey(role: string): string | null {
  const r = role.toUpperCase();
  if (r === "WAITER") return "dashboard.role.waiter";
  if (r === "KITCHEN") return "dashboard.role.kitchen";
  if (r === "BAR") return "dashboard.role.bar";
  if (r === "CASHIER") return "dashboard.role.cashier";
  if (r === "FLOOR_MANAGER") return "dashboard.role.floorMgr";
  if (r === "DELIVERY") return "dashboard.role.driver";
  return null;
}

// Wall-clock formatter — uses the restaurant's tz so a clerk on a phone
// set to a different timezone still sees the restaurant's local time
// when they walk in to clock on.
function formatWallClock(epochMs: number, lang: string): string {
  try {
    return new Intl.DateTimeFormat(lang === "ar" ? "ar-EG" : "en-GB", {
      timeZone: RESTAURANT_TZ,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(epochMs);
  } catch {
    const d = new Date(epochMs);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
}
