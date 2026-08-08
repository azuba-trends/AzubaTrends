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

  function stripHtml(html) {
    if (!html) return "";
    // Plain string strip (no DOM parser needed) — good enough for search
    // indexing purposes, doesn't need to be perfect HTML parsing.
    return String(html).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  }

  async function ensureIndex() {
    if (fuseIndex) return fuseIndex;
    allProducts = await ProductLoader.loadAllProducts();
    // Precompute plain-text search fields once (not stored back onto the
    // product objects used elsewhere — just for this index) so Fuse never
    // has to match against raw HTML tags from the rich-text editor.
    const indexable = allProducts.map((p) => ({
      ...p,
      searchDescription: stripHtml(p.description) + " " + stripHtml(p.shortDescription)
    }));
    fuseIndex = new Fuse(indexable, {
      keys: [
        { name: "title", weight: 0.4 },
        { name: "brand", weight: 0.25 },
        { name: "tags", weight: 0.2 },
        { name: "category", weight: 0.15 },
        { name: "keyphrase", weight: 0.15 },
        { name: "searchDescription", weight: 0.1 },
        { name: "color", weight: 0.1 },
        { name: "size", weight: 0.05 }
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
    const results = fuseIndex.search(query);
    const items = ProductLoader.sortByStock(ProductLoader.dedupeVariantGroups(results.map((r) => r.item)));
    return { top: items.slice(0, MAX_SUGGESTIONS), total: items.length };
  }

  function buildSuggestionRow(product, rawQuery) {
    const row = document.createElement("a");
    row.href = ProductLoader.productUrl(product);
    row.className = "search-suggestion" + (ProductLoader.isUnavailable(product) ? " is-out-of-stock" : "");
    row.setAttribute("role", "option");

    const img = document.createElement("img");
    // Dropdown suggestion thumbnail is tiny (~40-48px on screen) — request
    // a right-sized ImageKit render instead of the full product photo
    // (see optimizedImageUrl in product-loader.js; no-op for non-ImageKit
    // URLs like ImgBB).
    const rawImg = (product.images && product.images[0]) || "";
    img.src = rawImg ? ProductLoader.optimizedImageUrl(rawImg, 120) : "";
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
    const variantLabel = product.color ? `${product.color} · ` : "";
    sub.textContent = ProductLoader.isUnavailable(product)
      ? `${variantLabel}${product.category || ""} · Out of stock`
      : `${variantLabel}${product.category || ""} · ${ProductLoader.formatPrice(product.sellingPrice)}`;

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
    let currentTotal = 0;
    let currentQuery = "";
    let highlightedIndex = -1;

    function goToResultsPage(query) {
      window.location.href = `/search?q=${encodeURIComponent(query)}`;
    }

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
      if (currentTotal > 0) {
        const seeAll = document.createElement("a");
        seeAll.href = `/search?q=${encodeURIComponent(query)}`;
        seeAll.className = "search-see-all";
        seeAll.textContent = `See all ${currentTotal} result${currentTotal === 1 ? "" : "s"} for "${query}"`;
        dropdown.appendChild(seeAll);
      }
      dropdown.hidden = false;
    }

    const runSearch = debounce(async (query) => {
      if (!query || query.trim().length < 2) {
        closeDropdown();
        return;
      }
      await ensureIndex();
      currentQuery = query.trim();
      const { top, total } = rankedSearch(currentQuery);
      currentMatches = top;
      currentTotal = total;
      renderDropdown(currentQuery);
    }, DEBOUNCE_MS);

    input.addEventListener("input", (e) => runSearch(e.target.value));

    input.addEventListener("focus", () => {
      if (currentMatches.length > 0 && input.value.trim().length >= 2) {
        dropdown.hidden = false;
      }
    });

    // Keyboard navigation through suggestions (product rows only — the
    // "See all results" link at the bottom isn't part of this list, it's
    // reached with a normal Tab/click same as any other link).
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
        // A specific suggestion highlighted via arrow keys -> go straight
        // there. Otherwise -> full search results page, not just "guess
        // the first match" like before.
        if (highlightedIndex >= 0 && rows[highlightedIndex]) {
          window.location.href = rows[highlightedIndex].getAttribute("href");
        } else if (currentQuery) {
          goToResultsPage(currentQuery);
        }
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
        const query = input.value.trim();
        if (query.length >= 2) goToResultsPage(query);
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

  // Used by search.html to get the FULL (not top-8) match list for the
  // real results page/grid — same Fuse index this file already builds
  // for the header dropdown, so there's only one search implementation.
  window.SiteSearch = {
    async fullResults(query) {
      if (!query || query.trim().length < 2) return [];
      await ensureIndex();
      return fullSearchAll(query.trim());
    }
  };

  function fullSearchAll(query) {
    const results = fuseIndex.search(query);
    return ProductLoader.sortByStock(ProductLoader.dedupeVariantGroups(results.map((r) => r.item)));
  }
})();
