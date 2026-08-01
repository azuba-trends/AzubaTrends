/**
 * site-flags.js
 * ------------------------------------------------------------------
 * Generic on/off switch for whole sections, driven by flags in
 * js/site-config.js (window.SITE_CONFIG). Any element marked
 * data-flag="someKey" is hidden (via the `hidden` attribute — never
 * removed from the DOM) whenever window.SITE_CONFIG.someKey is falsy,
 * and shown again the instant that flag is flipped back to true.
 *
 * Right now this only drives the homepage "offers" strip
 * (data-flag="showOffers"), but any future section can opt in the same
 * way — just add data-flag="yourFlagName" to it and a matching key in
 * SITE_CONFIG. Works identically on mobile and desktop since it's the
 * same DOM element either way.
 * ------------------------------------------------------------------
 */
(function () {
  function apply() {
    document.querySelectorAll("[data-flag]").forEach((el) => {
      const key = el.getAttribute("data-flag");
      el.hidden = !window.SITE_CONFIG || !window.SITE_CONFIG[key];
    });
  }
  document.addEventListener("DOMContentLoaded", apply);
  // Config values that come from Firestore (settings/store_config) arrive
  // later than DOMContentLoaded — re-apply once they're in, in case a
  // future flag ever moves from the hardcoded default into Firestore.
  window.addEventListener("siteconfig:ready", apply);
})();
