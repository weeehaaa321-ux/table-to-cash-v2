"use client";

import { useEffect, useState } from "react";

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
  const [state, setState] = useState<"loading" | "in" | "out">("loading");
  const [since, setSince] = useState<Date | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 60000);
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
        setError("Try again");
      }
    } catch {
      setError("Network error");
    }
    setBusy(false);
  };

  if (state === "loading") {
    return <span className="text-[10px] text-text-muted">…</span>;
  }

  // ── Gate mode: staff is not clocked in ─────────────────────
  if (state === "out") {
    const firstName = name ? name.split(" ")[0] : "";
    const roleLabel = role ? role.replace(/_/g, " ").toLowerCase() : "";
    return (
      <div
        className="fixed inset-0 z-[100] flex items-center justify-center px-6 animate-fade-in"
        style={{
          backdropFilter: "blur(24px) saturate(1.4)",
          WebkitBackdropFilter: "blur(24px) saturate(1.4)",
          background:
            "linear-gradient(135deg, rgba(255,245,235,0.55) 0%, rgba(224,242,254,0.55) 100%)",
        }}
      >
        <div className="w-full max-w-sm text-center">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.2em] text-text-secondary">
            {firstName ? `Welcome, ${firstName}` : "Welcome"}
          </div>
          {roleLabel && (
            <div className="mb-8 text-xs text-text-muted capitalize">{roleLabel}</div>
          )}
          <button
            onClick={toggle}
            disabled={busy}
            className={`group relative w-48 h-48 rounded-full flex flex-col items-center justify-center mx-auto mb-6 bg-status-good-500 shadow-[0_20px_60px_rgba(16,185,129,0.35)] transition-all active:scale-95 ${
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
            <span className="text-white font-semibold text-xl tracking-wide uppercase">
              {busy ? "…" : "Clock In"}
            </span>
          </button>
          <p className="text-xs text-text-secondary leading-relaxed">
            Start your shift timer to unlock your {roleLabel || "staff"} view.
          </p>
          {error && (
            <p className="mt-3 text-xs font-semibold text-status-bad-600">{error}</p>
          )}
        </div>
      </div>
    );
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
      title="Clock out"
      className={`inline-flex items-center gap-1.5 px-3 h-8 rounded-xl text-[11px] font-bold uppercase tracking-wider transition active:scale-95 bg-status-good-100 text-status-good-700 hover:bg-status-good-200 ${
        busy ? "opacity-50" : ""
      }`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-status-good-500 animate-pulse" />
      On · {elapsedLabel}
    </button>
  );
}
