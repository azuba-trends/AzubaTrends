/**
 * a2hs.js — "Add to Home Screen" prompt
 * ------------------------------------------------------------------
 * Shows a small install banner so visitors can add this storefront to
 * their phone's home screen, without relying only on the browser's own
 * (often-missed) install UI.
 *
 * Timing rules (deliberately NOT "every reload"):
 *   - Never shown twice in the same browser session (tab/reload-safe via
 *     sessionStorage).
 *   - After it's shown once (whether dismissed with the X or with
 *     "Remind me later"), it won't show again for A2HS_COOLDOWN_MS —
 *     even across closing and reopening the browser — so it shows again
 *     "next time they visit" only once that cooldown has passed.
 *   - Never shown if the site is already running installed (standalone
 *     display mode / iOS's navigator.standalone), or once the visitor
 *     has actually completed an install.
 *
 * Platform handling:
 *   - Chrome/Edge/Android (anything firing `beforeinstallprompt`): the
 *     button triggers the real native install prompt.
 *   - iOS Safari: there is no programmatic install API, so the button
 *     instead shows the manual "Tap Share → Add to Home Screen" steps.
 *   - Any other browser with neither path available: the banner simply
 *     never shows (nothing useful to offer).
 * ------------------------------------------------------------------
 */
(function () {
  "use strict";

  const SESSION_KEY = "a2hsShownThisSession";
  const LAST_SHOWN_KEY = "a2hsLastShown";
  const INSTALLED_KEY = "a2hsInstalled";
  const A2HS_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours

  function isStandalone() {
    return (
      window.matchMedia && window.matchMedia("(display-mode: standalone)").matches
    ) || window.navigator.standalone === true; // iOS Safari
  }

  function isIOS() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent) && !window.MSStream;
  }

  function safeGet(store, key) {
    try { return store.getItem(key); } catch (e) { return null; }
  }
  function safeSet(store, key, val) {
    try { store.setItem(key, val); } catch (e) { /* storage disabled — fail quietly */ }
  }

  function shouldConsiderShowing() {
    if (isStandalone()) return false;
    if (safeGet(localStorage, INSTALLED_KEY) === "1") return false;
    if (safeGet(sessionStorage, SESSION_KEY) === "1") return false;
    const last = parseInt(safeGet(localStorage, LAST_SHOWN_KEY) || "0", 10);
    if (Date.now() - last < A2HS_COOLDOWN_MS) return false;
    return true;
  }

  let deferredPrompt = null;

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    maybeShow();
  });

  window.addEventListener("appinstalled", () => {
    safeSet(localStorage, INSTALLED_KEY, "1");
    hideBanner();
  });

  let bannerEl = null;
  let shown = false;

  function markShownNow() {
    safeSet(sessionStorage, SESSION_KEY, "1");
    safeSet(localStorage, LAST_SHOWN_KEY, String(Date.now()));
  }

  function buildBanner() {
    const storeName = (window.SITE_CONFIG && window.SITE_CONFIG.siteName) || "our store";
    const iosMode = isIOS() && !deferredPrompt;

    const wrap = document.createElement("div");
    wrap.id = "a2hs-banner";
    wrap.setAttribute("role", "dialog");
    wrap.setAttribute("aria-label", "Add to Home Screen");
    wrap.innerHTML = `
      <div class="a2hs-card">
        <button type="button" class="a2hs-close" aria-label="Close">&times;</button>
        <div class="a2hs-body">
          <img class="a2hs-icon" src="/images/icons/icon-192.png" alt="" width="44" height="44">
          <div class="a2hs-text">
            <strong class="a2hs-title">Add <span class="a2hs-storename"></span> to your Home Screen</strong>
            <span class="a2hs-sub">${iosMode
              ? "Tap the Share icon, then \u201cAdd to Home Screen\u201d."
              : "Quick access, no browser bar — just like an app."}</span>
          </div>
        </div>
        <div class="a2hs-actions">
          ${iosMode
            ? `<button type="button" class="btn btn-primary btn-sm a2hs-add">Got it</button>`
            : `<button type="button" class="btn btn-primary btn-sm a2hs-add">Add to Home Screen</button>`
          }
          <button type="button" class="btn btn-outline btn-sm a2hs-later">Remind me later</button>
        </div>
      </div>
    `;
    wrap.querySelector(".a2hs-storename").textContent = storeName;
    return wrap;
  }

  function hideBanner() {
    if (bannerEl && bannerEl.parentNode) {
      bannerEl.classList.remove("a2hs-in");
      setTimeout(() => bannerEl.remove(), 200);
    }
    bannerEl = null;
  }

  function dismiss() {
    markShownNow();
    hideBanner();
  }

  async function handleAddClick() {
    if (deferredPrompt) {
      hideBanner();
      deferredPrompt.prompt();
      try {
        const choice = await deferredPrompt.userChoice;
        if (choice && choice.outcome === "accepted") {
          safeSet(localStorage, INSTALLED_KEY, "1");
        } else {
          markShownNow(); // declined — still respect the cooldown before asking again
        }
      } catch (e) { /* ignore */ }
      deferredPrompt = null;
    } else {
      // iOS (or any browser with no native prompt available): nothing to
      // trigger programmatically — the banner's subtext already gave the
      // manual steps, so this button just closes it.
      dismiss();
    }
  }

  function showBanner() {
    if (shown) return;
    shown = true;
    bannerEl = buildBanner();
    document.body.appendChild(bannerEl);
    requestAnimationFrame(() => bannerEl.classList.add("a2hs-in"));

    bannerEl.querySelector(".a2hs-close").addEventListener("click", dismiss);
    bannerEl.querySelector(".a2hs-later").addEventListener("click", dismiss);
    bannerEl.querySelector(".a2hs-add").addEventListener("click", handleAddClick);

    markShownNow();
  }

  function maybeShow() {
    if (shown || !shouldConsiderShowing()) return;
    // Only worth showing if we actually have something to offer: a real
    // native install prompt, or iOS manual instructions.
    if (deferredPrompt || isIOS()) showBanner();
  }

  function init() {
    if (isStandalone()) return;
    // beforeinstallprompt (Chrome/Edge/Android) can fire any time before
    // this; if it already fired, deferredPrompt is set and maybeShow()
    // was already called from that handler. iOS never fires it at all,
    // so give it a short delay after load rather than showing instantly.
    setTimeout(maybeShow, 1500);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
