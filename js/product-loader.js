/**
 * product-loader.js
 * ------------------------------------------------------------------
 * Fetches product data and renders it. Exposes a single global,
 * `ProductLoader`, used by index.html, category.html, product.html,
 * and search.js.
 *
 * ---- Why a manifest file? ----------------------------------------
 * A static site (no server, no build step) cannot ask "what files
 * exist in /products/" at runtime — there is nothing to answer that
 * question. So `/products/index.json` is a plain JSON array of
 * filenames that acts as a manual directory listing:
 *
 *   ["product-001.json", "product-002.json", ...]
 *
 * loadAllProducts() fetches that manifest first, then fetches every
 * file it lists. When the site owner wants to add a new product,
 * the workflow is: drop `product-009.json` into /products/, AND add
 * `"product-009.json"` to index.json. Forgetting the second step is
 * the most likely support question this file will generate — it's
 * called out again next to the fetch call below.
 * ------------------------------------------------------------------
 *
 * ---- Cart integration hooks (for Claude 3) ------------------------
 * This file does not implement cart state. It only renders markup
 * with predictable hooks for cart.js to attach to:
 *
 *   - Any "Add to Cart" button has the attribute `data-add-to-cart`
 *     plus `data-product-id`, `data-product-title`,
 *     `data-product-price` (sellingPrice, numeric string) and
 *     `data-product-image` already on the element, so cart.js can
 *     add an item without re-fetching product JSON. Buttons on
 *     out-of-stock products render with `aria-disabled="true"` and
 *     no `data-add-to-cart` attribute — cart.js should treat absence
 *     of that attribute as "not addable" rather than relying on
 *     visual state alone.
 *   - On product.html, the quantity input has `data-qty-input`.
 *   - The header cart icon links to `cart.html` (Claude 3's page)
 *     and has `id="cart-count-badge"` on the number span. This file
 *     listens for a `cart:updated` CustomEvent on `window` (reading
 *     `event.detail.count`) and updates that badge. If `window.Cart`
 *     is not yet loaded on a given page, the badge just shows 0
 *     instead of throwing.
 * ------------------------------------------------------------------
 */

const ProductLoader = (function () {
  const MANIFEST_URL = "products/index.json";
  const PRODUCTS_DIR = "products/";

  /** @type {Array<Object>|null} module-level cache so every page only fetches once */
  let cachedProducts = null;
  /** @type {Promise<Array<Object>>|null} in-flight request, to dedupe parallel callers */
  let inFlightRequest = null;

  const currency = (typeof SITE_CONFIG !== "undefined" && SITE_CONFIG.currencySymbol) || "₹";

  // ---------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------

  /**
   * Fetches products/index.json, then fetches every product file it
   * lists, in parallel. Results are cached for the lifetime of the
   * page. Malformed or missing individual product files are skipped
   * (logged to console) rather than failing the whole page.
   */
  async function loadAllProducts() {
    if (cachedProducts) return cachedProducts;
    if (inFlightRequest) return inFlightRequest;

    inFlightRequest = (async () => {
      let filenames = [];
      try {
        const manifestRes = await fetch(MANIFEST_URL);
        if (!manifestRes.ok) {
          throw new Error(`Manifest fetch failed: HTTP ${manifestRes.status}`);
        }
        filenames = await manifestRes.json();
      } catch (err) {
        // Manifest missing/broken means we truly have nothing to show.
        // Most common cause: a new product file was added but its name
        // wasn't also added to products/index.json (see file header).
        console.error("ProductLoader: could not load products/index.json", err);
        cachedProducts = [];
        return cachedProducts;
      }

      const results = await Promise.all(
        filenames.map(async (filename) => {
          try {
            const res = await fetch(PRODUCTS_DIR + filename);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const product = await res.json();
            if (!product || !product.id) {
              throw new Error("product JSON missing required 'id' field");
            }
            return product;
          } catch (err) {
            console.error(`ProductLoader: skipping ${filename} —`, err);
            return null;
          }
        })
      );

      cachedProducts = results.filter(Boolean);
      return cachedProducts;
    })();

    return inFlightRequest;
  }

  async function getProductById(id) {
    const products = await loadAllProducts();
    return products.find((p) => p.id === id) || null;
  }

  // ---------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------

  /** Discount % is never stored — always computed live from mrp/sellingPrice. */
  function calcDiscount(product) {
    if (!product || !product.mrp || product.sellingPrice >= product.mrp) return 0;
    return Math.round(((product.mrp - product.sellingPrice) / product.mrp) * 100);
  }

  function formatPrice(amount) {
    const n = Number(amount) || 0;
    return currency + n.toLocaleString("en-IN");
  }

  /**
   * Stable sort that pushes stock === 0 items to the end while
   * otherwise preserving the input order (Array.prototype.sort is
   * stable in all current evergreen engines, but we don't rely on
   * that silently — decorate with original index and break ties on it
   * explicitly so behaviour doesn't depend on engine internals).
   */
  function sortByStock(products) {
    return products
      .map((p, i) => ({ p, i }))
      .sort((a, b) => {
        const aOut = a.p.stock === 0 ? 1 : 0;
        const bOut = b.p.stock === 0 ? 1 : 0;
        if (aOut !== bOut) return aOut - bOut;
        return a.i - b.i;
      })
      .map((entry) => entry.p);
  }

  function getCategories(products) {
    return [...new Set(products.map((p) => p.category).filter(Boolean))].sort();
  }

  // ---------------------------------------------------------------
  // Rendering — shared between index.html and category.html so card
  // markup/logic lives in exactly one place.
  // ---------------------------------------------------------------

  function renderProductCard(product) {
    const card = document.createElement("article");
    card.className = "product-card" + (product.stock === 0 ? " is-out-of-stock" : "");

    const discount = calcDiscount(product);
    const image = (product.images && product.images[0]) || "";
    const title = product.title || "Untitled product";

    const media = document.createElement("div");
    media.className = "product-card__media";

    if (discount > 0 && product.stock !== 0) {
      const badge = document.createElement("span");
      badge.className = "price-tag";
      badge.textContent = `${discount}% OFF`;
      media.appendChild(badge);
    } else if (product.stock === 0) {
      const badge = document.createElement("span");
      badge.className = "price-tag price-tag--stock";
      badge.textContent = "Out of Stock";
      media.appendChild(badge);
    }

    const img = document.createElement("img");
    img.src = image;
    img.alt = title; // full (unescaped) text is safe here — .alt is a property, not parsed HTML
    img.loading = "lazy";
    img.width = 400;
    img.height = 400;
    media.appendChild(img);

    const link = document.createElement("a");
    link.href = `product.html?id=${encodeURIComponent(product.id)}`;
    link.className = "product-card__link";
    link.setAttribute("aria-label", title);
    link.appendChild(media);

    const body = document.createElement("div");
    body.className = "product-card__body";

    const category = document.createElement("span");
    category.className = "product-card__category";
    Security.setTextSafely(category, product.category || "");

    const titleEl = document.createElement("h3");
    titleEl.className = "product-card__title";
    Security.setTextSafely(titleEl, title);

    const priceRow = document.createElement("div");
    priceRow.className = "product-card__price-row";
    const priceCurrent = document.createElement("span");
    priceCurrent.className = "price-current";
    priceCurrent.textContent = formatPrice(product.sellingPrice);
    priceRow.appendChild(priceCurrent);
    if (discount > 0) {
      const priceMrp = document.createElement("span");
      priceMrp.className = "price-mrp";
      priceMrp.textContent = formatPrice(product.mrp);
      priceRow.appendChild(priceMrp);
    }

    body.appendChild(category);
    body.appendChild(titleEl);
    body.appendChild(priceRow);

    const cta = document.createElement("div");
    cta.className = "product-card__cta";
    const btn = document.createElement("button");
    btn.className = "btn btn-outline btn-block";
    if (product.stock === 0) {
      btn.textContent = "Out of Stock";
      btn.setAttribute("aria-disabled", "true");
      btn.disabled = true;
    } else {
      btn.textContent = "Add to Cart";
      // Cart hook — see file header. Claude 3's cart.js queries
      // [data-add-to-cart] and reads these attributes directly.
      btn.setAttribute("data-add-to-cart", "");
      btn.setAttribute("data-product-id", product.id);
      btn.setAttribute("data-product-title", title);
      btn.setAttribute("data-product-price", String(product.sellingPrice));
      btn.setAttribute("data-product-image", image);
    }
    cta.appendChild(btn);
    body.appendChild(cta);

    card.appendChild(link);
    card.appendChild(body);
    return card;
  }

  /**
   * Renders a list of products into a container element, replacing
   * its current contents. Shared by index.html and category.html.
   * Shows an empty-state message when the list is empty (e.g. a
   * category filter matched nothing).
   */
  function renderGrid(container, products, emptyMessage) {
    if (!container) return;
    container.innerHTML = "";
    if (!products || products.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      const h = document.createElement("h2");
      h.textContent = "No products found";
      const p = document.createElement("p");
      p.textContent = emptyMessage || "Try a different category or check back soon.";
      empty.appendChild(h);
      empty.appendChild(p);
      container.appendChild(empty);
      return;
    }
    const fragment = document.createDocumentFragment();
    sortByStock(products).forEach((product) => {
      fragment.appendChild(renderProductCard(product));
    });
    container.appendChild(fragment);
  }

  function renderCategoryChips(container, products, onSelect, activeCategory) {
    if (!container) return;
    container.innerHTML = "";
    const categories = ["All", ...getCategories(products)];
    categories.forEach((cat) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip" + ((cat === activeCategory) ? " is-active" : "");
      chip.textContent = cat;
      chip.addEventListener("click", () => onSelect(cat));
      container.appendChild(chip);
    });
  }

  // ---------------------------------------------------------------
  // Header behaviour, shared by every page: mobile bottom-nav active
  // state + cart badge wiring. Kept here (rather than a new file) to
  // respect the "minimal file count" constraint — every page already
  // loads this script.
  // ---------------------------------------------------------------

  function initHeader() {
    // Logo: SITE_CONFIG.logoUrl is intentionally blank until a hosted
    // logo URL is added later. Every page ships a text fallback
    // (#site-logo-text) that's shown by default; we only swap to the
    // <img> once a real URL exists, so nothing ever breaks on load.
    const logoImg = document.getElementById("site-logo-img");
    const logoText = document.getElementById("site-logo-text");
    const siteName = (typeof SITE_CONFIG !== "undefined" && SITE_CONFIG.siteName) || "Store";
    if (logoText) Security.setTextSafely(logoText, siteName);
    if (logoImg && typeof SITE_CONFIG !== "undefined" && SITE_CONFIG.logoUrl) {
      logoImg.src = SITE_CONFIG.logoUrl;
      logoImg.alt = siteName;
      logoImg.style.display = "";
      if (logoText) logoText.style.display = "none";
    }

    // Footer: copyright line reads siteName/year from SITE_CONFIG so
    // there's one source of truth instead of hardcoding it per page.
    document.querySelectorAll("[data-site-name]").forEach((el) => Security.setTextSafely(el, siteName));
    document.querySelectorAll("[data-copyright-year]").forEach((el) =>
      Security.setTextSafely(el, String((typeof SITE_CONFIG !== "undefined" && SITE_CONFIG.copyrightYear) || new Date().getFullYear()))
    );

    // Highlight the current page in the mobile bottom nav.
    const currentPage = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    document.querySelectorAll(".bottom-nav a[data-page], .site-nav a[data-page]").forEach((link) => {
      const page = link.getAttribute("data-page").toLowerCase();
      const isMatch = page === currentPage || (page === "index.html" && currentPage === "");
      link.classList.toggle("is-active", isMatch);
      if (isMatch) link.setAttribute("aria-current", "page");
    });

    // Cart badge: reflect Cart's current count immediately if Cart is
    // already loaded, then stay in sync via the cart:updated event.
    // Cart.js is Claude 3's file and may not be present on every page
    // (or may not have loaded yet) — both cases must fail quietly.
    const badges = document.querySelectorAll("[data-cart-count]");
    const setBadge = (count) => {
      const safeCount = Number.isFinite(count) ? count : 0;
      badges.forEach((b) => Security.setTextSafely(b, String(safeCount)));
    };

    try {
      if (typeof window.Cart !== "undefined" && window.Cart && typeof window.Cart.getItemCount === "function") {
        setBadge(window.Cart.getItemCount());
      } else {
        setBadge(0);
      }
    } catch (err) {
      setBadge(0);
    }

    window.addEventListener("cart:updated", (event) => {
      const count = event && event.detail ? event.detail.count : 0;
      setBadge(count);
    });
  }

  return {
    loadAllProducts,
    getProductById,
    calcDiscount,
    formatPrice,
    sortByStock,
    getCategories,
    renderProductCard,
    renderGrid,
    renderCategoryChips,
    initHeader
  };
})();
