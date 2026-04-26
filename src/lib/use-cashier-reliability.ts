"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { RESTAURANT_TZ } from "./restaurant-config";

/**
 * Four small guards that turn the cashier tab from "random browser window"
 * into something that survives a full 24h shift on a kiosk tablet.
 *
 * 1. Wake lock — asks the browser to keep the screen on. Re-acquires on
 *    visibilitychange because the browser revokes the lock whenever the
 *    tab loses focus.
 *
 * 2. Watchdog — records the last time /api/sessions/all came back 2xx.
 *    If we've been dark for > 90s AND the cashier isn't mid-payment,
 *    we hard-reload. Recovers from silent network deaths where the
 *    tab looks fine but the event loop is jammed or fetch is hung.
 *
 * 3. Daily 5am reload — every minute we check the current hour/min in
 *    the restaurant's timezone and, if it's exactly 05:00 and the
 *    cashier isn't mid-payment, reload. Clears any slow memory leak
 *    before the morning shift starts.
 *
 * 4. Version check — polls /api/version every 60s, compares to the
 *    build id bundled into *this* client, shows a "new version" banner
 *    when they diverge. Auto-reloads if idle + not mid-payment after
 *    the cashier has had a minute to see the banner.
 *
 * The `isBusyRef` is the single shared gate across all four: when the
 * cashier is staring at the confirm-payment modal or a settle is in
 * flight, NOTHING reloads. A reload mid-transaction would lose the
 * optimistic state and force them to re-enter the payment.
 */
export function useCashierReliability(isBusyRef: MutableRefObject<boolean>) {
  const [newVersion, setNewVersion] = useState<string | null>(null);
  const lastOkRef = useRef<number>(Date.now());
  const versionSeenAtRef = useRef<number | null>(null);
  const reloadAttemptsRef = useRef<number>(0);

  // ── 1. Wake lock ─────────────────────────────────────────────────
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        if (typeof navigator === "undefined") return;
        const anyNav = navigator as Navigator & {
          wakeLock?: { request: (t: "screen") => Promise<WakeLockSentinel> };
        };
        if (!anyNav.wakeLock?.request) return;
        if (document.visibilityState !== "visible") return;
        lock = await anyNav.wakeLock.request("screen");
      } catch {
        /* unsupported or user-denied — silent */
      }
    };

    const onVisibility = () => {
      if (cancelled) return;
      if (document.visibilityState === "visible" && !lock) acquire();
    };

    acquire();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibility);
      try { lock?.release(); } catch { /* silent */ }
    };
  }, []);

  // ── 2. Watchdog reload on dead API ───────────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      if (isBusyRef.current) return;
      if (document.visibilityState !== "visible") return;
      const silentFor = Date.now() - lastOkRef.current;
      if (silentFor > 180_000) {
        // Cap reload attempts to prevent infinite reload loop when the
        // API is down. After 3 attempts, stop — the connection-lost
        // banner is visible and the user can manually reload later.
        if (reloadAttemptsRef.current >= 3) return;
        reloadAttemptsRef.current += 1;
        window.location.reload();
      }
    }, 30_000);
    return () => clearInterval(interval);
  }, [isBusyRef]);

  // ── 3. Daily 5am reload ──────────────────────────────────────────
  useEffect(() => {
    const tz = RESTAURANT_TZ;
    const interval = setInterval(() => {
      if (isBusyRef.current) return;
      try {
        const fmt = new Intl.DateTimeFormat("en-US", {
          timeZone: tz,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        });
        const parts = fmt.formatToParts(new Date());
        const hour = parts.find((p) => p.type === "hour")?.value;
        const minute = parts.find((p) => p.type === "minute")?.value;
        if (hour === "05" && minute === "00") {
          window.location.reload();
        }
      } catch { /* silent */ }
    }, 60_000);
    return () => clearInterval(interval);
  }, [isBusyRef]);

  // ── 4. Version check ─────────────────────────────────────────────
  useEffect(() => {
    const myVersion = process.env.NEXT_PUBLIC_BUILD_ID || "dev";
    let stopped = false;

    const check = async () => {
      if (stopped) return;
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/version", { cache: "no-store" });
        if (!res.ok) return;
        const { version } = (await res.json()) as { version: string };
        if (!version || version === "dev" || version === myVersion) return;
        if (!versionSeenAtRef.current) versionSeenAtRef.current = Date.now();
        setNewVersion(version);
        // Auto-reload 60s after first seeing the banner, if the cashier
        // isn't mid-payment. Gives them time to finish what they're
        // doing and see the banner; after that, we take over.
        const seenFor = Date.now() - versionSeenAtRef.current;
        if (seenFor > 60_000 && !isBusyRef.current) {
          window.location.reload();
        }
      } catch { /* silent */ }
    };

    check();
    const interval = setInterval(check, 60_000);
    return () => { stopped = true; clearInterval(interval); };
  }, [isBusyRef]);

  const markApiOk = useCallback(() => {
    lastOkRef.current = Date.now();
    reloadAttemptsRef.current = 0;
  }, []);

  const reloadNow = useCallback(() => {
    window.location.reload();
  }, []);

  return { newVersion, markApiOk, reloadNow };
}

// Minimal type stub — WakeLockSentinel isn't in all TS lib.dom versions.
type WakeLockSentinel = {
  release: () => Promise<void>;
};
