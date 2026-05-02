// Push notification system using Service Worker
// Works on Android lock screen and when app is closed

let swRegistration: ServiceWorkerRegistration | null = null;

export async function registerServiceWorker(): Promise<boolean> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return false;
  try {
    // updateViaCache: "none" forces the browser to always check for a
    // fresh sw.js on registration instead of trusting its HTTP cache.
    // Without this, an old sw.js can stay installed indefinitely after
    // a deploy that ships fixes to push-event handling.
    swRegistration = await navigator.serviceWorker.register("/sw.js", {
      updateViaCache: "none",
    });
    // Force the active SW to upgrade if a newer one is waiting — the
    // skipWaiting() in sw.js handles install, but registration needs
    // to nudge it.
    if (swRegistration.waiting) swRegistration.waiting.postMessage({ type: "SKIP_WAITING" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Register the SW eagerly on page load — independent of whether the
 * user has granted notification permission yet. Without this, the SW
 * was only being registered after the user tapped "Allow" on the
 * permission prompt; if they dismissed the prompt or Chrome was
 * killed before they tapped, the SW never installed and no pushes
 * could be delivered. The SW registration itself does NOT require
 * permission — only `Notification.requestPermission()` does.
 */
export async function registerSWEager(): Promise<boolean> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return false;
  // If something already registered the SW (e.g. a previous mount),
  // re-use it. ServiceWorker registration is idempotent at the
  // browser level but skipping the call avoids a noisy network hit.
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) {
      swRegistration = existing;
      return true;
    }
  } catch { /* fall through and register fresh */ }
  return registerServiceWorker();
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  if (Notification.permission === "granted") {
    await registerServiceWorker();
    return true;
  }
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  if (result === "granted") {
    await registerServiceWorker();
    return true;
  }
  return false;
}

export function canNotify(): boolean {
  if (typeof window === "undefined" || !("Notification" in window)) return false;
  return Notification.permission === "granted";
}

async function ensureSW(): Promise<ServiceWorkerRegistration | null> {
  if (swRegistration) return swRegistration;
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    swRegistration = await navigator.serviceWorker.ready;
    return swRegistration;
  } catch {
    return null;
  }
}

export async function sendNotification(title: string, body: string, tag?: string, url?: string) {
  if (!canNotify()) return;

  const reg = await ensureSW();
  if (reg) {
    // Use service worker — works on Android even when app is closed
    reg.active?.postMessage({
      type: "SHOW_NOTIFICATION",
      title,
      body,
      tag: tag || `ttc-${Date.now()}`,
      data: { url: url || "/waiter" },
    });
  } else {
    // Fallback: direct Notification API (desktop)
    if (document.visibilityState === "visible") return;
    try {
      new Notification(title, { body, tag: tag || `ttc-${Date.now()}`, icon: "/icon-192.png" });
    } catch { /* silent */ }
  }
}

// Specific notification types
export function notifyOrderPlaced(tableNumber: number, orderNumber: number) {
  sendNotification(
    `New Order — Table ${tableNumber}`,
    `Order #${orderNumber} placed. Accept it now.`,
    `order-new-${orderNumber}`,
    "/waiter"
  );
}

export function notifyOrderReady(tableNumber: number, orderNumber: number) {
  sendNotification(
    `Order Ready — Table ${tableNumber}`,
    `Order #${orderNumber} is ready to serve.`,
    `order-ready-${orderNumber}`,
    "/waiter"
  );
}

export function notifyOwnerCommand(message: string) {
  sendNotification(
    "Owner Message",
    message,
    `owner-${Date.now()}`,
    "/waiter"
  );
}

export function notifyVoiceNote(from: string) {
  sendNotification(
    "Voice Note from Owner",
    `${from} sent you a voice note. Open the app to listen.`,
    `voice-${Date.now()}`,
    "/waiter"
  );
}
