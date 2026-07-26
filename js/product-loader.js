const ProductLoader = (function () {
  let cachedProducts = null;
  let inFlightRequest = null;
  const currency = "₹";

  // Mirrors lib/pricing.js exactly (this file is loaded as a classic
  // script, not a module, so it can't `import` that one) — only used on
  // the direct-Firestore fallback path below, since the normal /api/products
  // path already returns margin-applied prices from the server.
  function applyStoreMarginLocal(sellingPrice) {
    const price = Number(sellingPrice) || 0;
    const margin = window.SITE_CONFIG && window.SITE_CONFIG.storeMargin;
    if (!margin || !margin.value) return price;
    const value = Number(margin.value) || 0;
    if (value <= 0) return price;
    const marked = margin.type === "flat" ? price + value : price + (price * value) / 100;
    return Math.round(marked);
  }

  async function loadAllProducts() {
    if (cachedProducts) return cachedProducts;
    if (inFlightRequest) return inFlightRequest;

    inFlightRequest = (async () => {
      // Try the server-cached endpoint first — this is what makes product
      // loading fast and stops every page load from hitting Firestore
      // directly from the browser. See api/products.js for the full
      // caching explanation.
      try {
        const res = await fetch("/api/products");
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.products)) {
            cachedProducts = data.products;
            return cachedProducts;
          }
        }
        console.warn("ProductLoader: /api/products unavailable (status " + res.status + "), falling back to direct Firestore read.");
      } catch (err) {
        console.warn("ProductLoader: /api/products fetch failed, falling back to direct Firestore read.", err);
      }

      // Fallback: the original direct-from-browser Firestore read. Keeps
      // the site working even when hosted somewhere without serverless
      // functions, or before the service account is configured.
      try {
        while(!window.FirebaseApp) { await new Promise(r => setTimeout(r, 100)); }
        if (window.SITE_CONFIG_READY) await window.SITE_CONFIG_READY; // needed for storeMargin below
        
        const { collection, getDocs, query, where } = await import("https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js");
        const db = window.FirebaseApp.db;
        
        const q = query(collection(db, "products"), where("status", "==", "active"));
        const snapshot = await getDocs(q);
        
        // Same exclusion as api/list.js: a product with hasVariants:true
        // is only a template for the admin panel, never itself sellable.
        // Store Margin applied here too — same markup api/list.js applies
        // server-side (see lib/pricing.js) — so prices stay consistent
        // even on this fallback path.
        cachedProducts = snapshot.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter(p => !p.hasVariants)
          .map(p => ({
            ...p,
            sellingPrice: applyStoreMarginLocal(p.sellingPrice),
            rating: p.ratingCount ? Math.round((p.ratingSum / p.ratingCount) * 10) / 10 : 0,
            reviewCount: p.ratingCount || 0
          }));
        return cachedProducts;
      } catch (err) {
        console.error("ProductLoader Error:", err);
        return [];
      }
    })();
    return inFlightRequest;
  }

  async function getProductById(id) {
    const products = await loadAllProducts();
    return products.find((p) => p.id === id) || null;
  }

  async function getProductBySlug(slug) {
    const products = await loadAllProducts();
    return products.find((p) => p.slug === slug) || null;
  }

  // A variant's public URL is /products/{parentId}/{variantSlug} — the
  // parentId in the path is what keeps two different products' variants
  // from ever colliding even if their size/color text is identical
  // (e.g. two unrelated products both having a "M / Red").
  function productUrl(product) {
    if (!product) return "/";
    if (product.isVariant && product.parentId && product.variantSlug) {
      return `/products/${encodeURIComponent(product.parentId)}/${encodeURIComponent(product.variantSlug)}`;
    }
    return product.slug ? `/products/${encodeURIComponent(product.slug)}` : `product.html?id=${encodeURIComponent(product.id)}`;
  }

  // A color can have several sizes, and every size is still its own real
  // product doc (own stock/price/sku) — but they all share ONE variantSlug
  // (the color's slug), because a color is ONE product page, not one per
  // size. Several docs can therefore match here; pick an in-stock one to
  // land on by default, falling back to the first if all are out of stock.
  async function getProductByParentAndVariantSlug(parentId, variantSlug) {
    const products = await loadAllProducts();
    const matches = products.filter((p) => p.isVariant && p.parentId === parentId && p.variantSlug === variantSlug);
    if (matches.length === 0) return null;
    return matches.find((p) => p.stock > 0) || matches[0];
  }

  // Collapses same-color sibling docs (one per size) down to a single
  // representative for grid/listing display, so a color with 5 sizes shows
  // as ONE card, not 5. Non-variant products and each distinct color still
  // get their own card. Prefers an in-stock size as the representative.
  function dedupeVariantGroups(products) {
    const bestByKey = new Map();
    const order = [];
    (products || []).forEach((p) => {
      const key = (p.isVariant && p.parentId && p.variantSlug) ? `${p.parentId}::${p.variantSlug}` : `single::${p.id}`;
      const cur = bestByKey.get(key);
      if (!cur) {
        bestByKey.set(key, p);
        order.push(key);
      } else if (cur.stock === 0 && p.stock > 0) {
        bestByKey.set(key, p);
      }
    });
    return order.map((k) => bestByKey.get(k));
  }

  // Every other variant of the same product (siblings), used to build
  // the Size/Color selector on the product page. Includes the product
  // itself so callers don't need a separate "is this the current one"
  // special case.
  async function getVariantSiblings(product) {
    if (!product || !product.isVariant || !product.parentId) return [product].filter(Boolean);
    const products = await loadAllProducts();
    return products.filter((p) => p.isVariant && p.parentId === product.parentId);
  }

  function calcDiscount(product) {
    if (!product || !product.mrp || product.sellingPrice >= product.mrp) return 0;
    return Math.round(((product.mrp - product.sellingPrice) / product.mrp) * 100);
  }

  // ------------------------------------------------------------------
  // Size ordering — clothing sizes must show XS, S, M, L, XL... in that
  // logical order, never however they happened to be added in the admin
  // panel or however Set/array order came out. Anything not in this
  // known list (e.g. numeric sizes like "30", "32", "6", "7", or free
  // -text sizes like "Free Size") sorts numerically if it looks like a
  // number, then alphabetically, and always AFTER the known apparel
  // sizes above so a stray "Free Size" doesn't jump to the front.
  // ------------------------------------------------------------------
  const SIZE_ORDER = [
    "xxxs", "xxs", "xs", "s", "m", "l", "xl", "xxl", "xxxl", "2xl", "3xl", "4xl", "5xl", "6xl"
  ];
  function sizeSortRank(size) {
    const key = String(size || "").trim().toLowerCase();
    const idx = SIZE_ORDER.indexOf(key);
    return idx === -1 ? null : idx;
  }
  function sortSizes(sizes) {
    return [...(sizes || [])].sort((a, b) => {
      const ra = sizeSortRank(a), rb = sizeSortRank(b);
      if (ra !== null && rb !== null) return ra - rb;
      if (ra !== null) return -1; // known apparel sizes always come first
      if (rb !== null) return 1;
      const na = parseFloat(a), nb = parseFloat(b);
      const aIsNum = !isNaN(na) && /^\s*[\d.]+\s*$/.test(String(a));
      const bIsNum = !isNaN(nb) && /^\s*[\d.]+\s*$/.test(String(b));
      if (aIsNum && bIsNum) return na - nb;
      if (aIsNum) return -1;
      if (bIsNum) return 1;
      return String(a).localeCompare(String(b));
    });
  }

  function formatPrice(amount) {
    return currency + Number(amount || 0).toLocaleString("en-IN");
  }

  function sortByStock(products) {
    return products.sort((a, b) => {
      if(a.stock === 0 && b.stock > 0) return 1;
      if(b.stock === 0 && a.stock > 0) return -1;
      return 0;
    });
  }

  function getCategories(products) {
    return [...new Set(products.map((p) => p.category).filter(Boolean))].sort();
  }

  function renderProductCard(product) {
    const card = document.createElement("article");
    card.className = "product-card" + (product.stock === 0 ? " is-out-of-stock" : "");

    const discount = calcDiscount(product);
    const image = (product.images && product.images[0]) ? product.images[0] : "images/logo-placeholder.svg";
    // All product-supplied text is escaped before going into innerHTML —
    // product data comes from the admin panel, which is itself reachable by
    // anyone who can get a malicious string into a field, so it's treated as
    // untrusted the same way user-typed text would be.
    const safeTitle = window.Security ? window.Security.escapeHTML(product.title) : String(product.title || "");
    const safeCategory = window.Security ? window.Security.escapeHTML(product.category) : String(product.category || "");
    const safeImage = window.Security ? window.Security.escapeHTML(image) : image;
    // This card represents the whole color (every size of it), not one
    // specific size, so only the color is shown here — the size itself is
    // picked on the product page, not implied by which card was clicked.
    const variantBadge = (product.isVariant && product.color)
      ? `<span class="product-card__variant" style="color:var(--color-ink-soft); font-size:0.8em;"> — ${window.Security ? window.Security.escapeHTML(product.color) : product.color}</span>`
      : "";

    const ratingBadge = (product.reviewCount > 0)
      ? `<span class="product-card__rating">
          <svg viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M10 1.5l2.6 5.6 6.1.6-4.6 4.1 1.3 6-5.4-3.2-5.4 3.2 1.3-6L1.3 7.7l6.1-.6z"/></svg>
          ${Number(product.rating).toFixed(1)} <span class="product-card__rating-count">(${product.reviewCount})</span>
        </span>`
      : "";

    card.innerHTML = `
      <a href="${productUrl(product)}" class="product-card__link">
        <div class="product-card__media">
          ${product.stock === 0 ? `<span class="price-tag price-tag--stock">Out of Stock</span>` : ''}
          <img src="${safeImage}" alt="${safeTitle}" loading="lazy">
        </div>
      </a>
      <div class="product-card__body">
        <div class="product-card__top-row">
          <span class="product-card__category">${safeCategory}</span>
          ${ratingBadge}
        </div>
        <h3 class="product-card__title">${safeTitle}${variantBadge}</h3>
        <div class="product-card__price-row">
          <span class="price-current">${formatPrice(product.sellingPrice)}</span>
          ${discount > 0 ? `<span class="price-mrp">${formatPrice(product.mrp)}</span>` : ''}
          ${discount > 0 && product.stock > 0 ? `<span class="price-tag price-tag--inline">${discount}% OFF</span>` : ''}
        </div>
        <div class="product-card__cta" data-cta-mount></div>
      </div>
    `;

    if (product.stock !== 0) {
      const ctaMount = card.querySelector("[data-cta-mount]");
      window.CartButtonUI && window.CartButtonUI.mount(ctaMount, {
        productId: product.id,
        title: safeTitle,
        price: product.sellingPrice,
        image: safeImage,
        stock: product.stock
      });
    } else {
      card.querySelector("[data-cta-mount]").innerHTML = `<button class="btn btn-outline btn-block" disabled>Out of Stock</button>`;
    }
    return card;
  }

  function renderSkeletonGrid(container, count = 6) {
    if (!container) return;
    container.innerHTML = "";
    for (let i = 0; i < count; i++) {
      const card = document.createElement("div");
      card.className = "product-card product-card--skeleton";
      card.innerHTML = `
        <div class="skeleton skeleton--media"></div>
        <div class="product-card__body">
          <div class="skeleton skeleton--line" style="width:40%;"></div>
          <div class="skeleton skeleton--line" style="width:80%; height:1.1em;"></div>
          <div class="skeleton skeleton--line" style="width:55%;"></div>
          <div class="skeleton skeleton--line skeleton--btn"></div>
        </div>`;
      container.appendChild(card);
    }
  }

  function renderGrid(container, products, emptyMessage) {
    if (!container) return;
    container.innerHTML = "";
    products = dedupeVariantGroups(products);
    if (!products || products.length === 0) {
      container.innerHTML = `<div class="empty-state"><h2>No products found</h2><p>${emptyMessage || "Try another category."}</p></div>`;
      return;
    }
    sortByStock(products).forEach((product) => {
      container.appendChild(renderProductCard(product));
    });
  }

  function renderCategoryChips(container, products, onSelect, activeCategory) {
    if (!container) return;
    container.innerHTML = "";
    ["All", ...getCategories(products)].forEach((cat) => {
      const chip = document.createElement("button");
      chip.className = "chip" + ((cat === activeCategory) ? " is-active" : "");
      chip.textContent = cat;
      chip.addEventListener("click", () => onSelect(cat));
      container.appendChild(chip);
    });
  }

  // ------------------------------------------------------------------
  // Lightweight interest tracking (cookie-based) + related/recommended
  // products. No third-party analytics involved — just a small cookie
  // (`interest_categories`) counting how many times each category has been
  // viewed on this browser, read back to rank "Recommended for you".
  // ------------------------------------------------------------------
  function trackCategoryInterest(category) {
    if (!category) return;
    try {
      const raw = document.cookie.split("; ").find((c) => c.startsWith("interest_categories="));
      const data = raw ? JSON.parse(decodeURIComponent(raw.split("=")[1])) : {};
      data[category] = (data[category] || 0) + 1;
      document.cookie = `interest_categories=${encodeURIComponent(JSON.stringify(data))}; path=/; max-age=${60 * 60 * 24 * 180}; SameSite=Lax`;
    } catch (err) { /* cookies disabled or blocked — recommendations just fall back to "no preference" */ }
  }

  function getTopInterestCategories() {
    try {
      const raw = document.cookie.split("; ").find((c) => c.startsWith("interest_categories="));
      if (!raw) return [];
      const data = JSON.parse(decodeURIComponent(raw.split("=")[1]));
      return Object.entries(data).sort((a, b) => b[1] - a[1]).map(([cat]) => cat);
    } catch (err) {
      return [];
    }
  }

  /** Picks related/recommended products: same category as `excludeId`'s
   *  product first (if given), then the shopper's most-viewed categories
   *  from the interest cookie, then just newest-in-stock as a last resort —
   *  so this never comes up empty as long as *some* other product exists. */
  function pickRelatedProducts(allProducts, { excludeId, excludeParentId, category, limit = 8 } = {}) {
    const pool = dedupeVariantGroups(allProducts.filter((p) => {
      if (String(p.id) === String(excludeId)) return false;
      // Don't recommend a product's own other sizes/colors as "related" —
      // those belong in the variant selector, not this grid.
      if (excludeParentId && p.isVariant && String(p.parentId) === String(excludeParentId)) return false;
      return true;
    }));
    const buckets = [];
    if (category) buckets.push(pool.filter((p) => p.category === category));
    getTopInterestCategories().forEach((cat) => buckets.push(pool.filter((p) => p.category === cat)));
    buckets.push(pool); // fallback: anything else

    const seen = new Set();
    const result = [];
    for (const bucket of buckets) {
      for (const p of bucket) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        result.push(p);
        if (result.length >= limit) return result;
      }
    }
    return result;
  }

  /** Renders the related-products row into `container`. Previously this
   *  waited for an IntersectionObserver to report the (often 0-height,
   *  not-yet-populated) container as "intersecting" before rendering
   *  anything — on some layouts/browsers that observer callback never
   *  fired, so the whole "You might also like" section silently stayed
   *  empty. Now it just renders straight away (this is a small catalog,
   *  so there's no real performance cost to not lazy-loading it), and
   *  any error is caught so a data hiccup shows the empty-state instead
   *  of leaving a blank gap on the page. */
  function mountRelatedProducts(container, opts) {
    if (!container) return;
    renderRelatedProductsNow(container, opts);
  }

  async function renderRelatedProductsNow(container, opts) {
    renderSkeletonGrid(container, 4);
    try {
      const all = await loadAllProducts();
      const related = pickRelatedProducts(all, opts);
      if (related.length === 0) {
        container.innerHTML = `<div class="empty-state"><h2>No related products yet</h2><p>Check back soon as more products are added.</p></div>`;
        return;
      }
      container.innerHTML = "";
      related.forEach((p) => container.appendChild(renderProductCard(p)));
    } catch (err) {
      console.error("ProductLoader: could not load related products", err);
      container.innerHTML = `<div class="empty-state"><h2>No related products yet</h2><p>Check back soon as more products are added.</p></div>`;
    }
  }

  function initHeader() {
    const siteName = window.SITE_CONFIG.siteName || "AzubaTrends";
    
    // Update all places where Site Name should appear
    document.querySelectorAll("[data-site-name]").forEach(el => el.textContent = siteName);
    
    // Update Page Title if it contains old name
    if(document.title.includes("AzubaTrends") && siteName !== "AzubaTrends") {
      document.title = document.title.replace("AzubaTrends", siteName);
    }

    // Keep the "Add to Home Screen" name (iOS) in sync with the real
    // store name too, same reasoning as the <title> patch above.
    const appTitleMeta = document.getElementById("apple-app-title-meta");
    if (appTitleMeta && siteName !== "AzubaTrends") {
      appTitleMeta.setAttribute("content", siteName);
    }

    const setBadge = (count) => {
      document.querySelectorAll("[data-cart-count]").forEach(b => b.textContent = count);
    };
    if (window.Cart) setBadge(window.Cart.getItemCount());
    window.addEventListener("cart:updated", (e) => setBadge(e.detail.count));
  }

  const API = { loadAllProducts, getProductById, getProductBySlug, getProductByParentAndVariantSlug, getVariantSiblings, dedupeVariantGroups, productUrl, calcDiscount, formatPrice, sortByStock, sortSizes, getCategories, renderProductCard, renderGrid, renderSkeletonGrid, renderCategoryChips, initHeader, trackCategoryInterest, mountRelatedProducts };
  window.ProductLoader = API;
  return API;
})();