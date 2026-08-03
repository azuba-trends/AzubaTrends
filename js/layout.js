/**
 * layout.js
 * ------------------------------------------------------------------
 * SINGLE SOURCE OF TRUTH for header + footer. Every page ships two
 * empty mount points instead of copy-pasted markup:
 *
 *   <div id="header-mount"></div>
 *   ...
 *   <div id="footer-mount"></div>
 *
 * This script fetches partials/header.html and partials/footer.html
 * and injects them into those mounts. Editing the header or footer
 * now means editing ONE file (partials/header.html or
 * partials/footer.html) — every page picks up the change automatically,
 * nothing to copy-paste or keep in sync by hand.
 *
 * Because the fetch is async, header/footer content isn't in the DOM
 * yet at DOMContentLoaded. Any script that needs it (search.js,
 * ProductLoader.initHeader, per-page inline init scripts) must wait
 * for the `layout:ready` event this file dispatches on `window` once
 * both partials are injected, instead of relying on DOMContentLoaded.
 * ------------------------------------------------------------------
 */
(function () {
  "use strict";

  // Non-secret by design — this is the VAPID PUBLIC key, meant to ship in
  // client JS. The matching private key lives only as a Cloudflare Pages
  // environment secret, used server-side in functions/api/send-push.js.
  const VAPID_PUBLIC_KEY = "BLBXcUg_SIOOn9zl8dS7FgCvPgBy4vBFmcvPp9l8D3WpTDLwZ8AciONxyBf1DCiRwMR6T0_NpAkn_J-g4Da6l30";

  function urlBase64ToUint8Array(base64String) {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
  }

  // Registers sw.js (idempotent — safe to call on every page load; the
  // browser no-ops if the same worker is already registered and up to
  // date). This alone is what's needed for push notifications to work
  // AND for the browser to consider the site installable.
  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return null;
    try {
      return await navigator.serviceWorker.register("/sw.js");
    } catch (err) {
      console.error("Service worker registration failed:", err);
      return null;
    }
  }

  // Subscribes this browser to push, asking for Notification permission
  // in the process if it hasn't been decided yet (pushManager.subscribe()
  // triggers the native prompt itself — no separate
  // Notification.requestPermission() call needed). Call this from a UI
  // moment that already explained WHY (e.g. a soft prompt after Add to
  // Cart), not on page load — see the geolocation soft-prompt in
  // product.html for the pattern this should follow once that UI exists.
  //
  // Returns true if this browser ends up subscribed (whether it already
  // was, or just became so), false otherwise (declined, unsupported, or
  // the save-to-server call failed).
  // Persistent per-browser id — NOT a login/account, just a random string
  // this browser keeps reusing. It's the only way to connect "this push
  // subscription" to "this order" later without a login system: checkout.js
  // stamps it on the order, subscribe() below stamps the same value on the
  // push subscription, and admin.js's order-status-update handler uses it
  // to notify only the customer who actually placed that order (see
  // functions/api/send-push.js's targeted mode).
  function getDeviceId() {
    try {
      let id = localStorage.getItem("azuba_device_id");
      if (!id) {
        id = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`).replace(/-/g, "");
        localStorage.setItem("azuba_device_id", id);
      }
      return id;
    } catch (err) {
      return null; // private browsing/quota — order still places, just won't get push updates
    }
  }
  window.getAzubaDeviceId = getDeviceId;

  async function subscribe() {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
    try {
      const registration = await registerServiceWorker();
      if (!registration) return false;

      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
      }

      const res = await fetch("/api/push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON(), deviceId: getDeviceId() })
      });
      if (!res.ok) throw new Error("Couldn't save subscription to the server.");

      try { localStorage.setItem("azuba_push_subscribed", "1"); } catch (err) { /* ignore */ }
      return true;
    } catch (err) {
      // Includes the user dismissing/blocking the native permission
      // prompt — that rejects subscribe() with a NotAllowedError, which
      // lands here same as any other failure. Nothing to alert about;
      // caller just gets `false` back.
      console.error("Push subscribe failed:", err);
      return false;
    }
  }

  function isSubscribedLocally() {
    try { return localStorage.getItem("azuba_push_subscribed") === "1"; } catch (err) { return false; }
  }

  window.AzubaPush = { subscribe, isSubscribedLocally };

  // Register on every page load (not just when someone subscribes) so
  // the worker is ready to receive pushes even between visits, and so
  // Chrome's install-prompt criteria are met site-wide.
  registerServiceWorker();

  async function loadPartial(url, mountId) {
    const mount = document.getElementById(mountId);
    if (!mount) return;
    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
      const html = await res.text();
      // Replace the mount div itself with the fetched markup so the
      // final DOM looks exactly like it would if it had been written
      // inline on the page (no extra wrapper div left behind).
      const temp = document.createElement("div");
      temp.innerHTML = html;
      mount.replaceWith(...temp.childNodes);
    } catch (err) {
      console.error("Layout: failed to load", url, err);
      // Fail visibly rather than silently leaving the page headerless —
      // easier to spot than a blank gap while debugging.
      mount.textContent = "";
    }
  }

  async function init() {
    await Promise.all([
      loadPartial("/partials/header.html", "header-mount"),
      loadPartial("/partials/footer.html", "footer-mount")
    ]);

    // "Coming soon" notice — shared by every entry point that leads to a
    // feature that isn't built yet (Account/Profile, Wishlist). No accounts
    // or wishlist backend exist, so these open a small notice instead of a
    // dead link. Ordering without an account still works fully (checkout
    // never required one).
    const devModal = document.getElementById("account-dev-modal");
    const devModalClose = document.getElementById("account-dev-modal-close");
    const devModalText = document.getElementById("account-dev-modal-text");
    const devTriggers = [
      { el: document.getElementById("bottom-nav-account"), msg: "Accounts are currently in development — you can order without one." },
      { el: document.getElementById("header-account-btn"), msg: "Accounts are currently in development — you can order without one." }
      // Wishlist now has a real page (backed by localStorage) — no longer
      // routed through this "coming soon" notice, see partials/header.html
      // and partials/footer.html.
    ];
    if (devModal) {
      devTriggers.forEach(({ el, msg }) => {
        if (!el) return;
        el.addEventListener("click", (e) => {
          e.preventDefault();
          if (devModalText) devModalText.textContent = msg;
          devModal.hidden = false;
        });
      });
      devModal.addEventListener("click", (e) => {
        if (e.target === devModal) devModal.hidden = true;
      });
    }
    if (devModalClose && devModal) {
      devModalClose.addEventListener("click", () => { devModal.hidden = true; });
    }

    // "Policies" nav dropdown — opens on hover (desktop mouse) via CSS
    // already, but also needs a click/tap toggle for keyboard and
    // touch/trackpad users where :hover doesn't reliably fire. Closes on
    // outside click, on Escape, and after picking a link.
    const policiesDropdown = document.getElementById("policies-dropdown");
    const policiesTrigger = document.getElementById("policies-dropdown-trigger");
    if (policiesDropdown && policiesTrigger) {
      const setOpen = (open) => {
        policiesDropdown.classList.toggle("is-open", open);
        policiesTrigger.setAttribute("aria-expanded", open ? "true" : "false");
      };
      policiesTrigger.addEventListener("click", (e) => {
        e.stopPropagation();
        setOpen(!policiesDropdown.classList.contains("is-open"));
      });
      document.addEventListener("click", (e) => {
        if (!policiesDropdown.contains(e.target)) setOpen(false);
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") setOpen(false);
      });
      policiesDropdown.querySelectorAll(".site-nav__dropdown-panel a").forEach((a) => {
        a.addEventListener("click", () => setOpen(false));
      });
    }

    // Footer social icons — no accounts live yet, so these are placeholders
    // (same "do nothing yet" pattern as Become a Seller below) rather than
    // dead-looking "#" jumps.
    document.querySelectorAll(".footer-social-link").forEach((a) => {
      a.addEventListener("click", (e) => { e.preventDefault(); });
    });

    // Footer newsletter subscribe — no email backend wired up yet, so this
    // just gives the visitor visible confirmation instead of a dead form.
    const subscribeForm = document.getElementById("footer-subscribe-form");
    const subscribeNote = document.getElementById("footer-subscribe-note");
    if (subscribeForm && subscribeNote) {
      subscribeForm.addEventListener("submit", (e) => {
        e.preventDefault();
        subscribeNote.hidden = false;
        subscribeForm.reset();
      });
    }

    // "Become a Seller" — intentionally does nothing yet (feature is
    // planned for a future update). Prevent the "#" href from jumping
    // the page to the top rather than leaving it a dead "#" link.
    const becomeSellerLink = document.getElementById("become-seller-link");
    if (becomeSellerLink) {
      becomeSellerLink.addEventListener("click", (e) => { e.preventDefault(); });
    }

    // Push notification permission — ask directly via the browser's own
    // native prompt as soon as the site loads (no custom banner/button
    // in between). If the visitor hasn't decided yet ("default"), we
    // retry once every 24 hours on future visits until they Allow or
    // Block it — same effect as a server-side "check every 24h" cron,
    // just done client-side since permission state lives in the browser,
    // not on our server.
    maybeRequestPushPermission();

    window.dispatchEvent(new CustomEvent("layout:ready"));
  }

  // Ask directly via the browser's own native permission popup — no
  // custom banner/button in between, same as most storefronts. If the
  // visitor hasn't decided yet ("default", i.e. never Allowed or
  // Blocked), we try again once every 24 hours on future visits until
  // they do. This 24h re-check is what stands in for a server-side
  // "cron" here — permission state lives entirely in the visitor's
  // browser, not on our server, so there's nothing for an actual
  // backend cron job to check; re-running this on each page load
  // achieves the same result.
  //
  // Heads up: some browsers (notably Chrome) apply "quiet" throttling
  // to permission prompts that fire without a click first, and can
  // eventually suppress the popup for a site that repeatedly gets
  // dismissed. If you'd rather have a guaranteed prompt at the cost of
  // one extra tap, a click-triggered version of this is easy to bring
  // back — just ask.
  const PUSH_PERMISSION_LAST_TRY_KEY = "pushPermissionLastTry";
  const PUSH_PERMISSION_RETRY_MS = 24 * 60 * 60 * 1000; // 24 hours

  function maybeRequestPushPermission() {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
    if (Notification.permission === "denied") return; // browser blocks re-prompting anyway
    if (Notification.permission === "granted") {
      // Already allowed at some point — make sure it's actually saved
      // server-side (harmless no-op if it already is).
      if (!isSubscribedLocally()) subscribe();
      return;
    }
    // Notification.permission === "default" (not yet decided)
    try {
      const last = parseInt(localStorage.getItem(PUSH_PERMISSION_LAST_TRY_KEY) || "0", 10);
      if (Date.now() - last < PUSH_PERMISSION_RETRY_MS) return;
      localStorage.setItem(PUSH_PERMISSION_LAST_TRY_KEY, String(Date.now()));
    } catch (err) { /* storage disabled — just try every load, no real harm */ }
    subscribe();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
