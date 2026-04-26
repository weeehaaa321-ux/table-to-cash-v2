// Push notification system using Service Worker
// Works on Android lock screen and when app is closed

let swRegistration: ServiceWorkerRegistration | null = null;

export async function registerServiceWorker(): Promise<boolean> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return false;
  try {
    swRegistration = await navigator.serviceWorker.register("/sw.js");
    return true;
  } catch {
    return false;
  }
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
