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
      { el: document.getElementById("header-account-btn"), msg: "Accounts are currently in development — you can order without one." },
      { el: document.getElementById("bottom-nav-wishlist"), msg: "Wishlist is coming soon — for now, items stay easy to find in your cart." }
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

    window.dispatchEvent(new CustomEvent("layout:ready"));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
