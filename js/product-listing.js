/**
 * product-listing.js
 * ------------------------------------------------------------------
 * One shared implementation of: filter bar (category/price/size/
 * color/rating/in-stock) + sort + infinite-scroll pagination, used
 * on index.html, category.html and search.html so all three behave
 * identically instead of drifting apart as three separate copies.
 *
 * Depends on: product-loader.js (must load first — uses
 * ProductLoader.renderProductCard/formatPrice/getCategories).
 * ------------------------------------------------------------------
 */
const ProductListing = (function () {
  const PAGE_SIZE = 20;
  const SKELETON_DELAY_MS = 350; // see note in mount() below

  const DEFAULT_SORTS = [
    { value: "default", label: "Featured" },
    { value: "bestselling", label: "Best Selling" },
    { value: "price-asc", label: "Price: Low to High" },
    { value: "price-desc", label: "Price: High to Low" },
    { value: "rating", label: "Highest Rated" }
  ];
  const SEARCH_SORTS = [
    { value: "relevance", label: "Relevance" },
    ...DEFAULT_SORTS.slice(1)
  ];

  function uniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort();
  }

  /**
   * @param {HTMLElement} filterBarEl  empty container to render the filter UI into
   * @param {HTMLElement} gridEl       empty container the product grid renders into
   * @param {Array} sourceProducts     the full candidate list (already deduped/variant-collapsed)
   * @param {Object} [options]
   * @param {boolean} [options.isSearch]   use "Relevance" as the default sort (search.html)
   * @param {string}  [options.emptyMessage]
   */
  function mount(filterBarEl, gridEl, sourceProductsRaw, options = {}) {
    const sortChoices = options.isSearch ? SEARCH_SORTS : DEFAULT_SORTS;
    const emptyMessage = options.emptyMessage || "No products match these filters — try widening your search.";

    // Same dedup every other grid on the site uses (renderGrid, search
    // suggestions) — one card per color, not one per size. Known
    // trade-off: the Size filter below matches against that single
    // representative doc's size, so a color group whose in-stock
    // representative happens to be size M could be missed by an "S"
    // filter even if S exists elsewhere in that color's sizes. Fixing
    // that fully would mean expanding each card to carry its full size
    // list, which is a bigger change than this pass covers.
    const sourceProducts = ProductLoader.dedupeVariantGroups(sourceProductsRaw);

    const state = {
      category: options.initialCategory || "All",
      size: "All",
      color: "All",
      minRating: 0,
      inStockOnly: false,
      priceMin: "",
      priceMax: "",
      sort: sortChoices[0].value
    };

    const categories = uniqueSorted(sourceProducts.map((p) => p.category));
    const sizes = uniqueSorted(sourceProducts.map((p) => p.size));
    const colors = uniqueSorted(sourceProducts.map((p) => p.color));

    // ---- Filter bar UI ----
    filterBarEl.innerHTML = `
      <div class="filter-bar">
        <div class="filter-bar__row">
          ${categories.length > 1 ? `
          <select class="filter-select" data-filter="category" id="filter-category" name="category">
            <option value="All"${state.category === "All" ? " selected" : ""}>All Categories</option>
            ${categories.map((c) => `<option value="${c}"${state.category === c ? " selected" : ""}>${c}</option>`).join("")}
          </select>` : ""}
          ${sizes.length > 0 ? `
          <select class="filter-select" data-filter="size" id="filter-size" name="size">
            <option value="All">Any Size</option>
            ${sizes.map((s) => `<option value="${s}">${s}</option>`).join("")}
          </select>` : ""}
          ${colors.length > 0 ? `
          <select class="filter-select" data-filter="color" id="filter-color" name="color">
            <option value="All">Any Color</option>
            ${colors.map((c) => `<option value="${c}">${c}</option>`).join("")}
          </select>` : ""}
          <select class="filter-select" data-filter="minRating" id="filter-min-rating" name="minRating">
            <option value="0">Any Rating</option>
            <option value="4">4★ &amp; up</option>
            <option value="3">3★ &amp; up</option>
          </select>
          <input type="number" min="0" class="filter-price" data-filter="priceMin" id="filter-price-min" name="priceMin" placeholder="Min ₹">
          <input type="number" min="0" class="filter-price" data-filter="priceMax" id="filter-price-max" name="priceMax" placeholder="Max ₹">
          <label class="filter-checkbox">
            <input type="checkbox" data-filter="inStockOnly" id="filter-in-stock" name="inStockOnly"> In Stock Only
          </label>
          <button type="button" class="filter-clear" data-action="clear">Clear Filters</button>
          <select class="filter-select filter-select--sort" data-filter="sort" id="filter-sort" name="sort">
            ${sortChoices.map((s) => `<option value="${s.value}">${s.label}</option>`).join("")}
          </select>
        </div>
        <div class="filter-bar__count" data-role="count"></div>
      </div>
    `;

    const countEl = filterBarEl.querySelector('[data-role="count"]');
    filterBarEl.querySelectorAll("[data-filter]").forEach((el) => {
      const key = el.dataset.filter;
      el.addEventListener(el.type === "checkbox" ? "change" : el.tagName === "SELECT" ? "change" : "input", () => {
        state[key] = el.type === "checkbox" ? el.checked : (key === "minRating" ? Number(el.value) : el.value);
        if (key === "category" && typeof options.onCategoryChange === "function") options.onCategoryChange(state.category);
        applyAndRender();
      });
    });
    const clearBtn = filterBarEl.querySelector('[data-action="clear"]');
    if (clearBtn) {
      clearBtn.addEventListener("click", () => {
        state.category = "All"; state.size = "All"; state.color = "All";
        state.minRating = 0; state.inStockOnly = false; state.priceMin = ""; state.priceMax = "";
        state.sort = sortChoices[0].value;
        filterBarEl.querySelectorAll("[data-filter]").forEach((el) => {
          if (el.type === "checkbox") el.checked = false;
          else el.value = el.dataset.filter === "sort" ? sortChoices[0].value : (el.tagName === "SELECT" ? (el.querySelector("option")?.value ?? "All") : "");
        });
        if (typeof options.onCategoryChange === "function") options.onCategoryChange("All");
        applyAndRender();
      });
    }

    // ---- Filtering + sorting (pure, doesn't touch the DOM) ----
    function computeVisibleList() {
      let list = sourceProducts.filter((p) => {
        if (state.category !== "All" && p.category !== state.category) return false;
        if (state.size !== "All" && p.size !== state.size) return false;
        if (state.color !== "All" && p.color !== state.color) return false;
        if (state.minRating > 0 && Number(p.rating || 0) < state.minRating) return false;
        if (state.inStockOnly && ProductLoader.isUnavailable(p)) return false;
        if (state.priceMin !== "" && Number(p.sellingPrice) < Number(state.priceMin)) return false;
        if (state.priceMax !== "" && Number(p.sellingPrice) > Number(state.priceMax)) return false;
        return true;
      });

      // "default"/"relevance" = keep the incoming order exactly as given —
      // that order is already meaningful (the server's fair daily shuffle
      // for listing pages, or Fuse's relevance ranking for search), so
      // re-sorting here would just throw that away for no reason.
      if (state.sort === "price-asc") list = [...list].sort((a, b) => a.sellingPrice - b.sellingPrice);
      else if (state.sort === "price-desc") list = [...list].sort((a, b) => b.sellingPrice - a.sellingPrice);
      else if (state.sort === "rating") list = [...list].sort((a, b) => (b.rating || 0) - (a.rating || 0));
      else if (state.sort === "bestselling") list = [...list].sort((a, b) => (b.orderCount || 0) - (a.orderCount || 0));

      return list;
    }

    // ---- Infinite scroll ----
    let visibleList = [];
    let renderedCount = 0;
    let sentinelObserver = null;
    let loadingMore = false;

    function renderSkeletonBatch(count) {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < count; i++) {
        const card = document.createElement("div");
        card.className = "product-card product-card--skeleton";
        card.innerHTML = `
          <div class="skeleton skeleton--media"></div>
          <div class="product-card__body">
            <div class="product-card__top-row">
              <div class="skeleton skeleton--line" style="width:38%;"></div>
              <div class="skeleton skeleton--line" style="width:28%;"></div>
            </div>
            <div class="skeleton skeleton--line" style="width:85%; height:1.1em;"></div>
            <div class="skeleton skeleton--line" style="width:60%; height:1.1em;"></div>
            <div class="skeleton skeleton--line" style="width:50%;"></div>
            <div class="skeleton skeleton--line" style="width:35%;"></div>
          </div>`;
        frag.appendChild(card);
      }
      return frag;
    }

    function renderNextPage() {
      const batch = visibleList.slice(renderedCount, renderedCount + PAGE_SIZE);
      batch.forEach((p) => gridEl.appendChild(ProductLoader.renderProductCard(p)));
      renderedCount += batch.length;
    }

    function setupSentinel() {
      if (sentinelObserver) sentinelObserver.disconnect();
      const sentinel = document.createElement("div");
      sentinel.className = "product-grid__sentinel";
      sentinel.setAttribute("aria-hidden", "true");
      gridEl.after(sentinel);

      sentinelObserver = new IntersectionObserver((entries) => {
        if (!entries[0].isIntersecting) return;
        if (loadingMore || renderedCount >= visibleList.length) return;
        loadingMore = true;

        // The full result set is already sitting in the browser's memory
        // (one request already fetched everything), so the next page is
        // ready instantly — genuinely nothing to wait for. This short,
        // fixed pause exists purely so the skeleton loading state is
        // actually visible/legible for a moment instead of flashing by
        // unnoticed, the same way it would if this were a real network
        // fetch. It's not simulating a fake delay to look "more real" —
        // it's just giving the UI transition enough time to read.
        const skeletons = renderSkeletonBatch(Math.min(8, PAGE_SIZE));
        gridEl.appendChild(skeletons);
        setTimeout(() => {
          gridEl.querySelectorAll(".product-card--skeleton").forEach((el) => el.remove());
          renderNextPage();
          loadingMore = false;
          if (renderedCount >= visibleList.length) {
            sentinelObserver.disconnect();
            sentinel.remove();
          }
        }, SKELETON_DELAY_MS);
      }, { rootMargin: "600px 0px" }); // start loading well before the user hits the literal bottom

      sentinelObserver.observe(sentinel);
    }

    function applyAndRender() {
      if (sentinelObserver) { sentinelObserver.disconnect(); sentinelObserver = null; }
      const next = gridEl.nextElementSibling;
      if (next && next.classList.contains("product-grid__sentinel")) next.remove();

      visibleList = computeVisibleList();
      renderedCount = 0;
      gridEl.innerHTML = "";

      if (countEl) {
        countEl.textContent = visibleList.length === 0
          ? ""
          : `${visibleList.length} product${visibleList.length === 1 ? "" : "s"}`;
      }

      if (visibleList.length === 0) {
        gridEl.innerHTML = `<div class="empty-state"><h2>No products found</h2><p>${emptyMessage}</p></div>`;
        return;
      }

      renderNextPage();
      if (renderedCount < visibleList.length) setupSentinel();
    }

    applyAndRender();
    return { refresh: applyAndRender, getState: () => ({ ...state }) };
  }

  return { mount };
})();
