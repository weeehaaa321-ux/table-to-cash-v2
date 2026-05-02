"use client";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function readUiLang(): "en" | "ar" {
  // Same source the useLanguage hook reads from — keeps client and
  // server views of the user's language in sync.
  try {
    const stored = typeof localStorage !== "undefined"
      ? localStorage.getItem("ttc_lang")
      : null;
    return stored === "ar" ? "ar" : "en";
  } catch {
    return "en";
  }
}

export type SubscribeResult =
  | { ok: true }
  | { ok: false; reason: string; detail?: string };

export async function subscribeToPush(
  staffId: string,
  role: string,
  restaurantId: string,
  lang?: "en" | "ar",
): Promise<SubscribeResult> {
  if (!VAPID_PUBLIC_KEY) {
    return { ok: false, reason: "vapid_key_missing", detail: "NEXT_PUBLIC_VAPID_PUBLIC_KEY is empty in the deployed bundle. Server admin must set it in Vercel env vars and redeploy." };
  }
  if (!("serviceWorker" in navigator)) {
    return { ok: false, reason: "no_service_worker_support", detail: "This browser does not support service workers." };
  }
  if (!("PushManager" in window)) {
    return { ok: false, reason: "no_push_support", detail: "This browser does not support web push (iOS Safari requires the app added to home screen first)." };
  }
  if (Notification.permission !== "granted") {
    return { ok: false, reason: "permission_denied", detail: `Notification permission is "${Notification.permission}". Tap Enable on the banner to grant it.` };
  }

  let registration: ServiceWorkerRegistration;
  try {
    // Wait for the SW to be ready, with a 10s timeout. Without the
    // timeout, an SW that never registers will leave this call hung
    // indefinitely (the original silent-fail mode).
    registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<ServiceWorkerRegistration>((_, reject) =>
        setTimeout(() => reject(new Error("Service worker did not become ready within 10s")), 10_000),
      ),
    ]);
  } catch (err) {
    return { ok: false, reason: "service_worker_not_ready", detail: (err as Error).message };
  }

  let subscription: PushSubscription | null;
  try {
    subscription = await registration.pushManager.getSubscription();
  } catch (err) {
    return { ok: false, reason: "get_subscription_failed", detail: (err as Error).message };
  }

  if (!subscription) {
    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
    } catch (err) {
      // The most common cause here is an applicationServerKey
      // mismatch — the device already has a subscription tied to
      // a different VAPID key (e.g. v1's key). Auto-recover by
      // clearing and re-subscribing once.
      const message = (err as Error).message || "";
      if (/already subscribed|applicationServerKey/i.test(message)) {
        try {
          const stale = await registration.pushManager.getSubscription();
          if (stale) await stale.unsubscribe();
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
          });
        } catch (retryErr) {
          return { ok: false, reason: "subscribe_failed_after_reset", detail: (retryErr as Error).message };
        }
      } else {
        return { ok: false, reason: "subscribe_failed", detail: message };
      }
    }
  }

  const keys = subscription.toJSON().keys;
  if (!keys?.p256dh || !keys?.auth) {
    return { ok: false, reason: "missing_keys", detail: "Subscription returned without p256dh/auth keys." };
  }

  let res: Response;
  try {
    res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
        staffId,
        role,
        restaurantId,
        lang: lang ?? readUiLang(),
      }),
    });
  } catch (err) {
    return { ok: false, reason: "server_unreachable", detail: (err as Error).message };
  }

  if (!res.ok) {
    let body = "";
    try { body = await res.text(); } catch { /* ignore */ }
    return { ok: false, reason: "server_rejected", detail: `${res.status} ${res.statusText}${body ? ` — ${body.slice(0, 200)}` : ""}` };
  }

  return { ok: true };
}

export async function unsubscribeFromPush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await fetch("/api/push/unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      await subscription.unsubscribe();
    }
  } catch { /* silent */ }
}
