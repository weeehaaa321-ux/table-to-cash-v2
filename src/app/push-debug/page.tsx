"use client";

// ═══════════════════════════════════════════════════════
// PUSH DEBUG — open this page on the device that isn't getting
// notifications. It shows every layer of the push stack so we
// can pinpoint exactly where the chain breaks.
//
// URL: /push-debug?staffId=<id>
//
// The page is intentionally ugly and verbose. Disposable.
// ═══════════════════════════════════════════════════════

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function Wrapper() {
  return (
    <Suspense>
      <PushDebug />
    </Suspense>
  );
}

type Result = {
  // Browser-side state.
  notificationPermission: string;
  serviceWorkerSupported: boolean;
  pushManagerSupported: boolean;
  swRegistered: boolean;
  swState: string | null;
  swScope: string | null;
  swScript: string | null;
  vapidPublicLen: number;
  vapidPublicHash: string;
  hasSubscription: boolean;
  subscriptionEndpointHost: string | null;
  subscriptionApplicationServerKeyMatchesEnv: boolean | null;
  // Server-side state.
  serverVapidStatus: unknown;
  serverPushTestStatus: number | null;
  serverPushTestBody: unknown;
  serverSubscribeAttempt: { status: number; body: unknown } | null;
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function PushDebug() {
  const params = useSearchParams();
  const staffId = params.get("staffId") ?? "";
  const [r, setR] = useState<Result | null>(null);
  const [running, setRunning] = useState(false);

  async function run() {
    setRunning(true);
    const result: Result = {
      notificationPermission: "n/a",
      serviceWorkerSupported: false,
      pushManagerSupported: false,
      swRegistered: false,
      swState: null,
      swScope: null,
      swScript: null,
      vapidPublicLen: 0,
      vapidPublicHash: "",
      hasSubscription: false,
      subscriptionEndpointHost: null,
      subscriptionApplicationServerKeyMatchesEnv: null,
      serverVapidStatus: null,
      serverPushTestStatus: null,
      serverPushTestBody: null,
      serverSubscribeAttempt: null,
    };

    if (typeof Notification !== "undefined") {
      result.notificationPermission = Notification.permission;
    }
    result.serviceWorkerSupported = "serviceWorker" in navigator;
    result.pushManagerSupported = typeof window !== "undefined" && "PushManager" in window;

    const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
    result.vapidPublicLen = VAPID_PUBLIC.length;
    result.vapidPublicHash = VAPID_PUBLIC ? await sha256(VAPID_PUBLIC) : "";

    if (result.serviceWorkerSupported) {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) {
          result.swRegistered = true;
          const active = reg.active || reg.waiting || reg.installing;
          result.swState = active?.state ?? null;
          result.swScope = reg.scope;
          result.swScript = active?.scriptURL ?? null;
          if (result.pushManagerSupported) {
            const sub = await reg.pushManager.getSubscription();
            if (sub) {
              result.hasSubscription = true;
              try {
                result.subscriptionEndpointHost = new URL(sub.endpoint).host;
              } catch {
                result.subscriptionEndpointHost = sub.endpoint.slice(0, 60);
              }
              // Compare the subscription's applicationServerKey to
              // the current env VAPID public key. If they don't match,
              // this device is subscribed under an OLD VAPID key and
              // needs to re-subscribe.
              const optKey = (sub.options as PushSubscriptionOptions)?.applicationServerKey;
              if (optKey && VAPID_PUBLIC) {
                const subKey = bytesToBase64Url(new Uint8Array(optKey as ArrayBuffer));
                const envKey = VAPID_PUBLIC.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
                result.subscriptionApplicationServerKeyMatchesEnv = subKey === envKey;
              }
            }
          }
        }
      } catch (err) {
        console.error("SW probe failed:", err);
      }
    }

    // Hit /api/push/status — server-side VAPID env diagnostics.
    try {
      const res = await fetch("/api/push/status");
      result.serverVapidStatus = await res.json();
    } catch (err) {
      result.serverVapidStatus = { error: (err as Error).message };
    }

    // Hit /api/push/test with the staffId — actually sends a push.
    if (staffId) {
      try {
        const res = await fetch("/api/push/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ staffId }),
        });
        result.serverPushTestStatus = res.status;
        try { result.serverPushTestBody = await res.json(); }
        catch { result.serverPushTestBody = await res.text(); }
      } catch (err) {
        result.serverPushTestBody = { error: (err as Error).message };
      }
    }

    setR(result);
    setRunning(false);
  }

  async function forceResubscribe() {
    setRunning(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) await sub.unsubscribe();
      }
      // Unregister + re-register fresh so we get the latest sw.js.
      const allRegs = await navigator.serviceWorker.getRegistrations();
      for (const r of allRegs) await r.unregister();

      const newReg = await navigator.serviceWorker.register("/sw.js", {
        updateViaCache: "none",
      });
      await navigator.serviceWorker.ready;
      // Subscribe with the current VAPID key.
      const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";
      const padding = "=".repeat((4 - (VAPID_PUBLIC.length % 4)) % 4);
      const base64 = (VAPID_PUBLIC + padding).replace(/-/g, "+").replace(/_/g, "/");
      const raw = atob(base64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

      if (Notification.permission !== "granted") {
        const p = await Notification.requestPermission();
        if (p !== "granted") {
          alert("Permission was not granted: " + p);
          setRunning(false);
          return;
        }
      }

      const sub = await newReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: bytes as BufferSource,
      });

      const keys = sub.toJSON().keys!;
      const restaurantId = process.env.NEXT_PUBLIC_RESTAURANT_SLUG || "neom-dahab";
      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          p256dh: keys.p256dh,
          auth: keys.auth,
          staffId: staffId || null,
          role: "WAITER",
          restaurantId,
        }),
      });
      const body = await res.json().catch(() => ({}));
      alert(`Re-subscribe complete.\nstatus=${res.status}\nbody=${JSON.stringify(body).slice(0, 200)}`);
    } catch (err) {
      alert("Force resubscribe failed: " + (err as Error).message);
    } finally {
      setRunning(false);
      run();
    }
  }

  useEffect(() => { run(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  return (
    <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, padding: 16, color: "#111", background: "#fff", lineHeight: 1.4 }}>
      <h1 style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Push debug</h1>
      <p style={{ marginBottom: 12, color: "#555" }}>
        staffId: <b>{staffId || "(none — pass ?staffId=...)"}</b>
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button onClick={run} disabled={running} style={btn}>Refresh</button>
        <button onClick={forceResubscribe} disabled={running} style={{ ...btn, background: "#dc2626", color: "#fff" }}>Force re-subscribe</button>
      </div>
      <pre style={{ background: "#f3f3f3", padding: 12, borderRadius: 8, whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
        {r ? JSON.stringify(r, null, 2) : "loading..."}
      </pre>
    </div>
  );
}

const btn: React.CSSProperties = { padding: "8px 14px", borderRadius: 6, border: "1px solid #999", background: "#eee", cursor: "pointer", fontWeight: 600 };
