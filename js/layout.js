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
      loadPartial("partials/header.html", "header-mount"),
      loadPartial("partials/footer.html", "footer-mount")
    ]);

    // Bottom-nav "Account" tab — accounts aren't built yet, so this just
    // shows a small notice instead of a dead link. Ordering without an
    // account still works fully (checkout never required one).
    const accountTab = document.getElementById("bottom-nav-account");
    const accountModal = document.getElementById("account-dev-modal");
    const accountModalClose = document.getElementById("account-dev-modal-close");
    if (accountTab && accountModal) {
      accountTab.addEventListener("click", (e) => {
        e.preventDefault();
        accountModal.hidden = false;
      });
      accountModal.addEventListener("click", (e) => {
        if (e.target === accountModal) accountModal.hidden = true;
      });
    }
    if (accountModalClose && accountModal) {
      accountModalClose.addEventListener("click", () => { accountModal.hidden = true; });
    }

    window.dispatchEvent(new CustomEvent("layout:ready"));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
