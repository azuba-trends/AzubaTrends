/**
 * search.js
 * ------------------------------------------------------------------
 * Wires up every header search bar on the page (there's one per
 * page, since this is a plain multi-page static site with no
 * templating/includes). Uses Fuse.js (loaded from a CDN in each
 * HTML file, before this script) for genuine typo-tolerant fuzzy
 * matching against product title/tags/category, with a debounced
 * live autosuggest dropdown.
 *
 * Depends on: site-config.js, security.js, product-loader.js,
 * and the Fuse.js CDN script — all must be loaded first.
 * ------------------------------------------------------------------
 */

(function () {
  const DEBOUNCE_MS = 250;
  const MAX_SUGGESTIONS = 8;

  /** @type {Fuse|null} built once, shared by every search bar on the page */
  let fuseIndex = null;
  /** @type {Array<Object>} */
  let allProducts = [];

  function debounce(fn, delay) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  /** Wraps the matched substring of an already-escaped title in <mark>. */
  function highlightMatch(escapedTitle, rawQuery) {
    const q = escapeRegex(rawQuery.trim());
    if (!q) return escapedTitle;
    const re = new RegExp(`(${q})`, "ig");
    return escapedTitle.replace(re, "<mark>$1</mark>");
  }

  async function ensureIndex() {
    if (fuseIndex) return fuseIndex;
    allProducts = await ProductLoader.loadAllProducts();
    fuseIndex = new Fuse(allProducts, {
      keys: [
        { name: "title", weight: 0.5 },
        { name: "tags", weight: 0.3 },
        { name: "category", weight: 0.2 }
      ],
      threshold: 0.38, // permissive enough for real typos, not so loose it's noisy
      ignoreLocation: true,
      minMatchCharLength: 2
    });
    return fuseIndex;
  }

  /**
   * Runs the fuzzy search, then applies a stable secondary sort that
   * pushes out-of-stock products below in-stock ones — even when an
   * out-of-stock item is technically a slightly better text match.
   * Fuse's own ranking is preserved within each of those two groups.
   */
  function rankedSearch(query) {
    const results = fuseIndex.search(query, { limit: MAX_SUGGESTIONS * 3 });
    const items = results.map((r) => r.item);
    return ProductLoader.sortByStock(items).slice(0, MAX_SUGGESTIONS);
  }

  function buildSuggestionRow(product, rawQuery) {
    const row = document.createElement("a");
    row.href = `product.html?id=${encodeURIComponent(product.id)}`;
    row.className = "search-suggestion" + (product.stock === 0 ? " is-out-of-stock" : "");
    row.setAttribute("role", "option");

    const img = document.createElement("img");
    img.src = (product.images && product.images[0]) || "";
    img.alt = "";
    img.loading = "lazy";

    const meta = document.createElement("div");
    meta.className = "search-suggestion__meta";

    const titleEl = document.createElement("div");
    titleEl.className = "search-suggestion__title";
    // escapeHTML first, THEN inject <mark> highlight markup — never the
    // other way round, or the highlight step could reopen an XSS hole.
    titleEl.innerHTML = highlightMatch(Security.escapeHTML(product.title || ""), rawQuery);

    const sub = document.createElement("div");
    sub.className = "search-suggestion__sub";
    sub.textContent = product.stock === 0
      ? `${product.category || ""} · Out of stock`
      : `${product.category || ""} · ${ProductLoader.formatPrice(product.sellingPrice)}`;

    meta.appendChild(titleEl);
    meta.appendChild(sub);
    row.appendChild(img);
    row.appendChild(meta);
    return row;
  }

  function wireSearchBar(wrap) {
    const input = wrap.querySelector(".search-input");
    const dropdown = wrap.querySelector(".search-suggestions");
    const form = wrap.querySelector(".search-form");
    if (!input || !dropdown) return;

    let currentMatches = [];
    let highlightedIndex = -1;

    function closeDropdown() {
      dropdown.hidden = true;
      highlightedIndex = -1;
    }

    function renderDropdown(query) {
      dropdown.innerHTML = "";
      if (currentMatches.length === 0) {
        const empty = document.createElement("div");
        empty.className = "search-empty";
        empty.textContent = `No matches for "${query}"`;
        dropdown.appendChild(empty);
        dropdown.hidden = false;
        return;
      }
      currentMatches.forEach((product) => {
        dropdown.appendChild(buildSuggestionRow(product, query));
      });
      dropdown.hidden = false;
    }

    const runSearch = debounce(async (query) => {
      if (!query || query.trim().length < 2) {
        closeDropdown();
        return;
      }
      await ensureIndex();
      currentMatches = rankedSearch(query.trim());
      renderDropdown(query.trim());
    }, DEBOUNCE_MS);

    input.addEventListener("input", (e) => runSearch(e.target.value));

    input.addEventListener("focus", () => {
      if (currentMatches.length > 0 && input.value.trim().length >= 2) {
        dropdown.hidden = false;
      }
    });

    // Keyboard navigation through suggestions
    input.addEventListener("keydown", (e) => {
      const rows = Array.from(dropdown.querySelectorAll(".search-suggestion"));
      if (dropdown.hidden || rows.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        highlightedIndex = Math.min(highlightedIndex + 1, rows.length - 1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        highlightedIndex = Math.max(highlightedIndex - 1, 0);
      } else if (e.key === "Escape") {
        closeDropdown();
        return;
      } else if (e.key === "Enter") {
        e.preventDefault();
        const target = highlightedIndex >= 0 ? rows[highlightedIndex] : rows[0];
        if (target) window.location.href = target.getAttribute("href");
        return;
      } else {
        return;
      }

      rows.forEach((r, i) => r.classList.toggle("is-highlighted", i === highlightedIndex));
      rows[highlightedIndex].scrollIntoView({ block: "nearest" });
    });

    if (form) {
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const rows = Array.from(dropdown.querySelectorAll(".search-suggestion"));
        if (rows[0]) window.location.href = rows[0].getAttribute("href");
      });
    }

    document.addEventListener("click", (e) => {
      if (!wrap.contains(e.target)) closeDropdown();
    });
  }

  // The search bar lives inside the header partial, which is injected
  // asynchronously by layout.js — wait for that instead of
  // DOMContentLoaded, or querySelectorAll(".search-wrap") would find
  // nothing (header wouldn't exist in the DOM yet).
  window.addEventListener("layout:ready", () => {
    document.querySelectorAll(".search-wrap").forEach(wireSearchBar);
  });
})();
