/**
 * loading-overlay.js
 * ------------------------------------------------------------------
 * A single, sitewide loading indicator: a subtle white veil over the
 * page (low opacity — the page stays visible underneath, this is a
 * "something's happening" cue, not a blocking splash screen) with an
 * orange spinner in the center.
 *
 * IMPORTANT: the spin animation itself is an infinite CSS loop with no
 * fixed length — it never "finishes" on its own. Whether the overlay is
 * on screen for 200ms or 8 seconds, the spinner keeps spinning at the
 * same steady rate the whole time; only calling hide() removes it. That
 * means loading is always represented by "still visible" vs "gone", not
 * by an animation that plays out and stops regardless of whether the
 * real work is actually done yet.
 *
 * Usage from any page that includes this script:
 *   LoadingOverlay.show();
 *   try { await doSomethingSlow(); } finally { LoadingOverlay.hide(); }
 *
 * show()/hide() are reference-counted, so if two things are loading at
 * once, the overlay only disappears once BOTH have called hide() — a
 * second concurrent show() never gets "stolen" by the first hide().
 * ------------------------------------------------------------------
 */
(function () {
  "use strict";

  let pendingCount = 0;
  let overlayEl = null;

  function ensureElement() {
    if (overlayEl) return overlayEl;
    overlayEl = document.createElement("div");
    overlayEl.id = "global-loading-overlay";
    overlayEl.setAttribute("aria-hidden", "true");
    overlayEl.innerHTML = '<div class="global-loading-spinner"></div>';
    document.body.appendChild(overlayEl);
    return overlayEl;
  }

  function show() {
    pendingCount++;
    ensureElement().classList.add("is-visible");
  }

  function hide() {
    pendingCount = Math.max(0, pendingCount - 1);
    if (pendingCount === 0 && overlayEl) overlayEl.classList.remove("is-visible");
  }

  // Convenience wrapper: shows while `promiseFactory()` is in flight,
  // hides once it settles (success or failure) — one line at call sites
  // instead of a manual try/finally every time.
  async function wrap(promiseFactory) {
    show();
    try {
      return await promiseFactory();
    } finally {
      hide();
    }
  }

  window.LoadingOverlay = { show, hide, wrap };
})();
