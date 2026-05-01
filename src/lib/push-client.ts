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

export async function subscribeToPush(
  staffId: string,
  role: string,
  restaurantId: string,
  lang?: "en" | "ar",
): Promise<boolean> {
  if (!VAPID_PUBLIC_KEY || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return false;
  }

  try {
    const registration = await navigator.serviceWorker.ready;

    // Check if already subscribed
    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
    }

    const keys = subscription.toJSON().keys;
    if (!keys?.p256dh || !keys?.auth) return false;

    // Send subscription to server. `lang` lets the server pick the
    // right title/body when it pushes notifications to this device;
    // re-calling subscribeToPush after a language toggle updates it.
    await fetch("/api/push/subscribe", {
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

    return true;
  } catch (err) {
    console.warn("Push subscription failed:", err);
    return false;
  }
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
