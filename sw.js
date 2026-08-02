// sw.js — service worker
// ---------------------------------------------------------------------
// WHY THIS FILE EXISTS: purely to enable Web Push notifications (push +
// notificationclick below), and as a side effect it's also what makes
// Chrome/Edge/Android consider the site "installable" (the earlier
// Add-to-Home-Screen question).
//
// WHAT IT DELIBERATELY DOES NOT DO: cache anything. This store already
// relies on Cloudflare's own edge caching + whatever Cache-Control this
// site sends per path (see _headers) — a service worker that ALSO
// cached pages/assets would be a second, independent caching layer that
// could easily go stale and start serving old content even after
// Cloudflare and the origin have both moved on, forcing customers into
// hard-refreshes to see updates. So: no `caches.open()`, no
// `cache.put()`, no `caches.match()` anywhere in this file, on purpose.
// Every fetch the browser makes still goes straight to the network,
// exactly as if this service worker didn't exist at all.
//
// VERSIONING: bump SW_VERSION any time this file changes. Browsers
// re-fetch sw.js on every navigation and compare it byte-for-byte
// against what's currently installed; a version bump changes the bytes,
// which is what actually triggers the browser to install the new
// worker. Combined with skipWaiting()/clients.claim() below, an updated
// worker takes over immediately — no waiting for every open tab to
// close, no hard refresh needed. (See _headers for the other half of
// this: /sw.js itself is served with Cache-Control: no-cache, so
// Cloudflare's edge and the browser both always ask the origin for the
// latest copy of this exact file instead of serving a cached one.)
const SW_VERSION = "1";

self.addEventListener("install", (event) => {
  // Don't wait for existing tabs to close before activating — take over
  // as soon as this version is installed.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of any already-open tabs immediately too, instead of
  // only affecting the next navigation.
  event.waitUntil(self.clients.claim());
});

// Pure passthrough — no caching, see the big comment above.
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});

// ---- Web Push ---------------------------------------------------------
// Payload shape sent from functions/api/send-push.js:
//   { title, body, url, icon? }
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (err) { /* ignore malformed payload */ }

  const title = data.title || "AzubaTrends";
  const options = {
    body: data.body || "",
    icon: data.icon || "/images/icons/icon-192.png",
    badge: "/images/icons/icon-192.png",
    data: { url: data.url || "/" }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Reuse an already-open tab on this site if there is one, instead
      // of always opening a new one.
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      return self.clients.openWindow(targetUrl);
    })
  );
});
