/**
 * js/zoom-debug.js
 * -----------------
 * TEMPORARY diagnostic tool — does nothing unless the page URL has
 * ?debug=1 (or #debug). Safe to ship live; zero effect on real visitors.
 *
 * Purpose: on a real device where the page looks "zoomed"/narrow, this
 * finds whichever element(s) are wider than the visual viewport (the
 * classic cause of that look — the browser hasn't zoomed anything, the
 * page itself is just wider than the screen, so it *looks* zoomed/
 * cramped and the right edge gets clipped or requires a horizontal
 * scroll). It draws a red outline + label on every offending element
 * and shows a summary panel with the numbers that matter:
 *   - window.innerWidth vs document.documentElement.scrollWidth
 *   - visualViewport width/scale (if supported)
 *   - devicePixelRatio
 *   - the widest offending element, its selector, and by how much it
 *     overflows
 *
 * Remove this file (and its <script> tag) once the real bug is fixed —
 * it's diagnostic scaffolding, not meant to stay long-term.
 */
(function () {
  function hasDebugFlag() {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get("debug") === "1" || window.location.hash === "#debug";
    } catch (e) {
      return false;
    }
  }
  if (!hasDebugFlag()) return;

  function shortSelector(el) {
    if (!el || el === document.body) return "body";
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    if (el.className && typeof el.className === "string") {
      s += "." + el.className.trim().split(/\s+/).slice(0, 2).join(".");
    }
    return s;
  }

  function run() {
    const innerW = window.innerWidth;
    const scrollW = document.documentElement.scrollWidth;
    const vv = window.visualViewport;
    const dpr = window.devicePixelRatio || 1;
    // The TRUE visible width — on some OEM/WebView browsers window.innerWidth
    // itself is wrong (reports a wider "layout viewport" than what's
    // actually on screen, independent of any element overflowing). When
    // that happens visualViewport.width is the one that's still accurate,
    // so prefer it as the reference for "is this wider than the screen".
    const referenceW = vv ? vv.width : innerW;
    const viewportMismatch = vv && Math.abs(vv.width - innerW) > 2;

    // Clear any previous run's outlines/labels (in case of re-run after
    // dynamic content loads, e.g. products finishing rendering).
    document.querySelectorAll("[data-zoom-debug-outline]").forEach((el) => {
      el.style.outline = "";
      el.removeAttribute("data-zoom-debug-outline");
    });
    document.querySelectorAll(".zoom-debug-label").forEach((el) => el.remove());

    // Find every element wider than the true visible width (the actual
    // overflow culprits), sorted worst-first. Skip elements with no
    // rendered box.
    const all = document.querySelectorAll("body *");
    const offenders = [];
    all.forEach((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      const overflowRight = rect.right - referenceW;
      if (overflowRight > 1) {
        offenders.push({ el, rect, overflowRight });
      }
    });
    offenders.sort((a, b) => b.overflowRight - a.overflowRight);

    // Only outline the top-level offenders (skip an element if its
    // parent is already flagged — avoids painting every nested child of
    // one wide container, which just adds noise).
    const flagged = [];
    offenders.forEach((o) => {
      const alreadyFlaggedAncestor = flagged.some((f) => f.el.contains(o.el) && f.el !== o.el);
      if (alreadyFlaggedAncestor) return;
      flagged.push(o);
    });

    flagged.slice(0, 15).forEach((o, i) => {
      o.el.style.outline = "2px solid red";
      o.el.setAttribute("data-zoom-debug-outline", "1");
      const label = document.createElement("div");
      label.className = "zoom-debug-label";
      label.textContent = `#${i + 1} ${shortSelector(o.el)} +${Math.round(o.overflowRight)}px`;
      label.style.cssText =
        "position:absolute; z-index:99999; background:red; color:#fff; font:11px/1.3 monospace; " +
        "padding:2px 5px; border-radius:3px; pointer-events:none; white-space:nowrap;";
      const top = window.scrollY + o.rect.top;
      const left = window.scrollX + Math.max(0, o.rect.left);
      label.style.top = top + "px";
      label.style.left = left + "px";
      document.body.appendChild(label);
    });

    // Summary panel, fixed to the top of the screen so it's always
    // visible regardless of scroll position.
    let panel = document.getElementById("zoom-debug-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "zoom-debug-panel";
      panel.style.cssText =
        "position:fixed; top:0; left:0; right:0; z-index:999999; background:#111; color:#0f0; " +
        "font:11px/1.5 monospace; padding:8px 10px; max-height:40vh; overflow:auto; white-space:pre-wrap;";
      document.body.appendChild(panel);
    }
    const lines = [
      `innerWidth: ${innerW}px   scrollWidth: ${scrollW}px   overflow (vs innerWidth): ${scrollW - innerW}px`,
      vv ? `visualViewport: width=${vv.width.toFixed(1)} scale=${vv.scale.toFixed(3)} offsetLeft=${vv.offsetLeft.toFixed(1)}` : "visualViewport: not supported on this browser",
      viewportMismatch
        ? `⚠ MISMATCH: window.innerWidth (${innerW}px) ≠ visualViewport.width (${vv.width.toFixed(1)}px) — this browser is NOT respecting width=device-width. That alone explains a "zoomed out / everything small" look: the page is being laid out for a ${innerW}px canvas then squeezed into a ${vv.width.toFixed(1)}px screen.`
        : `viewport OK: innerWidth matches visualViewport.width (no engine-level mismatch).`,
      `devicePixelRatio: ${dpr}`,
      `UA: ${navigator.userAgent}`,
      flagged.length
        ? `Elements wider than the true screen width (${Math.round(referenceW)}px) — red outline:`
        : `No element wider than the true screen width (${Math.round(referenceW)}px) was found.`,
      ...flagged.slice(0, 15).map((o, i) => `  #${i + 1} ${shortSelector(o.el)} — right edge is ${Math.round(o.overflowRight)}px past the true screen edge`)
    ];
    panel.textContent = lines.join("\n");
  }

  // Run once on load, then again after a short delay (covers content
  // that finishes rendering — product images, similar-products strip,
  // etc. — after the initial paint) and once more on resize/orientation
  // change so it stays accurate if the phone is rotated.
  window.addEventListener("load", () => {
    run();
    setTimeout(run, 1500);
    setTimeout(run, 4000);
  });
  window.addEventListener("resize", () => setTimeout(run, 300));
})();
