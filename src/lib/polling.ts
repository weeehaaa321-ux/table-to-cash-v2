"use client";

// ═══════════════════════════════════════════════
// VISIBILITY-AWARE POLL
// ─ Skips ticks when document is hidden (tab in background,
//   phone screen off, app backgrounded).
// ─ Fires an immediate refresh when the tab becomes visible
//   again, so returning users never see stale data.
// ─ Cuts Vercel invocation count dramatically in real use:
//   kitchen tablets locked overnight, cashier screens idling,
//   guest phones in pockets — none of them hammer the API.
// ═══════════════════════════════════════════════

export function startPoll(fn: () => void, ms: number): () => void {
  if (typeof window === "undefined") return () => {};

  let stopped = false;

  const tick = () => {
    if (stopped) return;
    if (document.visibilityState === "hidden") return;
    fn();
  };

  const onVisibility = () => {
    if (stopped) return;
    if (document.visibilityState === "visible") fn();
  };

  const interval = setInterval(tick, ms);
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    stopped = true;
    clearInterval(interval);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}
