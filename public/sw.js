// Service Worker for Table-to-Cash push notifications
// Handles both Web Push (background) and postMessage (foreground) notifications
//
// Build version below changes on every commit-bump so devices that
// have an older sw.js cached detect a content change and install
// the new SW. Without a content change browsers leave stale SWs
// active for up to 24 hours.
const SW_VERSION = "2026-05-02-v4-revert";

self.addEventListener("install", (event) => {
  console.log("[sw] installing", SW_VERSION);
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("[sw] activated", SW_VERSION);
  event.waitUntil(self.clients.claim());
});

// Web Push — fires even when the phone is sleeping / app is closed
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "Table to Cash", body: event.data.text() };
  }

  const options = {
    body: payload.body || "",
    tag: payload.tag || `ttc-push-${Date.now()}`,
    icon: payload.icon || "/icon-192.png",
    badge: "/icon-192.png",
    vibrate: [200, 100, 200],
    requireInteraction: true,
    data: { url: payload.url || "/waiter" },
  };

  event.waitUntil(self.registration.showNotification(payload.title || "Table to Cash", options));
});

// Foreground messages from the main thread
self.addEventListener("message", (event) => {
  // Allow the page to force this SW to upgrade if a newer build is
  // waiting. Without this, a deployed fix to push-event handling
  // can sit dormant behind an old SW until the next browser restart.
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (event.data && event.data.type === "SHOW_NOTIFICATION") {
    const { title, body, tag, data } = event.data;
    self.registration.showNotification(title, {
      body,
      tag: tag || `ttc-${Date.now()}`,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      vibrate: [200, 100, 200],
      requireInteraction: true,
      data: data || {},
    });
  }
});

// Handle notification click — focus or open the app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/waiter";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(url) || client.url.includes("/waiter") || client.url.includes("/kitchen")) {
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
