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
const SW_VERSION = "3";

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
// Pure passthrough — see the big comment above. Only same-origin requests
// are re-issued through this worker's own fetch(); everything else (fonts,
// CDNs, product images on i.ibb.co, etc.) is left completely alone so the
// browser handles it exactly as if this service worker didn't exist. This
// also sidesteps a real gotcha: a request re-issued via fetch() *inside* a
// service worker is checked against the page's CSP `connect-src` directive
// regardless of what kind of resource it actually is (image, font, script)
// — so intercepting cross-origin requests here would mean every third-
// party domain the site ever uses has to also be listed in connect-src
// (see _headers) or it silently breaks, which is exactly what happened
// the first time this file went from 404 to actually being installed.
self.addEventListener("fetch", (event) => {
  if (new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(event.request));
});

// ---- Web Push ---------------------------------------------------------
// Payload shape sent from functions/api/send-push.js:
//   { title, body, url, icon?, image? }
//
// `image` (optional) is the big banner-style picture shown inside the
// notification body — same idea as Meesho/big-platform push, e.g. a
// product photo. It's just a URL: the actual bytes never travel through
// the push payload (which stays well under the ~4KB limit either way);
// the browser fetches it itself at display time, same as icon/badge.
//
// `renotify: true` + a shared `tag` means a second push about the SAME
// thing (e.g. re-sending a broadcast) still re-alerts (vibrate/sound)
// instead of silently replacing the old one with no signal. Each push
// still gets its own tag when the caller doesn't send one, so unrelated
// notifications never collapse into each other.
//
// `requireInteraction` is deliberately left unset (defaults to false) —
// this is what makes the notification float in as a heads-up banner and
// then auto-dismiss after a few seconds, instead of staying stuck on
// screen until the user manually closes it.
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (err) { /* ignore malformed payload */ }

  const title = data.title || "AzubaTrends";
  const options = {
    body: data.body || "",
    icon: data.icon || "/images/icons/icon-192.png",
    badge: "/images/icons/icon-192.png",
    vibrate: [200, 80, 200],
    renotify: true,
    tag: data.tag || `azuba-${Date.now()}`,
    data: { url: data.url || "/" }
  };
  if (data.image) options.image = data.image;
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
